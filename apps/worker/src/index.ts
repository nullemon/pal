import { getEnv } from '@palscans/core/env'
import { getQueue } from '@palscans/core/queue'
import { getStorage } from '@palscans/core/storage'
import { watermarkRunLive } from '@palscans/core/watermark'
import { chapters, closeDb, getDb, getSetting, series } from '@palscans/db'
import { and, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { BACKUP_SETTING_KEY, type BackupRun, backupEnv, runBackup } from './jobs/backup.js'
import { processChapter } from './jobs/chapter-process.js'
import { openSource, readImportConfig } from './jobs/import/resolve.js'
import { runImport } from './jobs/import-run.js'
import { registerNotifications } from './jobs/notify-index.js'
import { publishDue } from './jobs/publish.js'
import { type ArtKind, processSeriesArt } from './jobs/series-art.js'
import {
  createSitemapCoalescer,
  lastFullSitemapBuildAt,
  runSitemapBuild,
  sitemapEnv,
} from './jobs/sitemap.js'
import { runStatsRollup } from './jobs/stats-rollup.js'
import { readWatermarkRun, runWatermarkReapply } from './jobs/watermark-reapply.js'
import { createBackgroundTasks } from './lib/background.js'
import { installWorkerConfig } from './lib/config.js'
import { installCrashGuards } from './lib/crash.js'
import { createHeartbeat, heartbeatStaleMs } from './lib/health.js'
import { log } from './lib/log.js'
import { revalidateWeb, runMaintenance } from './lib/revalidate.js'
import { createShutdown } from './lib/shutdown.js'

/**
 * The PALScans worker (docs/16 "apps/worker"): the image pipeline (`chapter.process`), the
 * publish scheduler (every 30 s), and a safety net that picks up `processing` chapters no
 * job ever reached (the web app runs an in-process queue when REDIS_URL is unset).
 */
const SCHEDULER_MS = getEnv().WORKER_SCHEDULER_MS
/** How often `stats.rollup` is enqueued (docs/02: "every few minutes"). */
const ROLLUP_MS = getEnv().WORKER_ROLLUP_MS
let lastRollup = 0
/** How often `db.backup` is enqueued (docs/18 §9: nightly). */
const BACKUP_MS = backupEnv().WORKER_BACKUP_MS
/**
 * Seeded from the recorded run at startup, unlike `lastRollup`: a dump is expensive, and a
 * worker that restarts twice an hour during a deploy must not take a dump each time.
 */
let lastBackup = 0
/** How often a *full* `sitemap.build` is enqueued (docs/12 §5: nightly). Seeded, like backups. */
const SITEMAP_MS = sitemapEnv().WORKER_SITEMAP_MS
let lastSitemap = 0
const CONCURRENCY = getEnv().WORKER_CONCURRENCY
const PAGE_CONCURRENCY = getEnv().WORKER_PAGE_CONCURRENCY
const SHUTDOWN_TIMEOUT_MS = getEnv().WORKER_SHUTDOWN_TIMEOUT_MS

// Before anything can reject: startup itself does database and network work, and Node 22
// ends the process on an unhandled rejection.
installCrashGuards()

const main = async () => {
  const db = await getDb()
  // docs/19: point storage — and the credentials the notification jobs read — at what the
  // operator typed into the admin panel, before anything asks for a bucket. With nothing
  // stored (or no database) every one of them falls back to the environment.
  const credentials = installWorkerConfig(db)
  const storage = await getStorage()
  const queue = await getQueue()
  // Everything this process starts and does not await, so `shutdown` can wait for it.
  const tasks = createBackgroundTasks()
  /**
   * The publish → incremental `sitemap.build` producer (docs/12 §5). Both publish paths feed
   * it — the scheduler pass below and a chapter that goes live the moment its encode finishes
   * — and it collapses a release's worth of them into one build and one IndexNow submission.
   */
  const sitemaps = createSitemapCoalescer(queue)
  const deps = {
    db,
    storage,
    pageConcurrency: PAGE_CONCURRENCY,
    onPublished: ({ seriesId }: { seriesId: number }) => sitemaps.note([seriesId]),
  }
  const inflight = new Set<number>()

  const run = async (chapterId: number) => {
    if (inflight.has(chapterId)) return
    inflight.add(chapterId)
    try {
      await processChapter(chapterId, deps)
    } finally {
      inflight.delete(chapterId)
    }
  }

  /** Publish what is due and tell the catalogue and the sitemap about it. */
  const publishPass = async () => {
    const published = await publishDue(db)
    if (published.length === 0) return published
    await revalidateWeb(['catalog'])
    sitemaps.note(published.map((c) => c.seriesId))
    return published
  }

  queue.process(
    'chapter.process',
    async (job) => {
      await run(job.data.chapterId)
    },
    CONCURRENCY,
  )
  const artInflight = new Set<string>()
  const runArt = async (seriesId: number, kind: ArtKind) => {
    const id = `${seriesId}:${kind}`
    if (artInflight.has(id)) return
    artInflight.add(id)
    try {
      await processSeriesArt(seriesId, kind, deps)
    } finally {
      artInflight.delete(id)
    }
  }
  queue.process('series.art', async (job) => {
    await runArt(job.data.seriesId, job.data.kind)
  })
  queue.process('chapter.publish', async (job) => {
    await publishPass()
    log.info('chapter.publish handled by the scheduler pass', { chapterId: job.data.chapterId })
  })
  // The shared queue carries every job name (docs/16); the ones outside this scope are
  // acknowledged with a log line so they never pile up as failures. Integration wires them.
  // D · Notifications (docs/17 §D): takes over `notify.new_chapter` and runs the push /
  // digest / Discord passes on its own timer. Inert when VAPID and the bot token are unset.
  const notifications = registerNotifications(db, queue)

  // E · legacy importer (docs/17 §E). One run at a time — the `import_runs` live index
  // enforces that — and the job body is the resumable walker, so a redelivered job picks up
  // at the last committed batch instead of re-importing what already landed.
  queue.process('import.run', async (job) => {
    const config = await readImportConfig(db)
    const source = await openSource(config)
    try {
      await runImport(job.data.runId, {
        db,
        storage,
        queue,
        source,
        batchSize: config.batchSize,
        skipImages: config.skipImages,
      })
    } finally {
      await source.close?.()
    }
  })

  /**
   * `watermark.reapply` (docs/03): re-mark chapters that are already processed.
   *
   * One at a time and never twice in parallel — the run document is a single row and two
   * walkers would fight over its cursor. The job body is the resumable walker, so a
   * redelivered job (or the cold-run pickup in the tick below) carries on from the last
   * committed chapter instead of re-encoding the catalogue.
   */
  let reapplyInflight = false
  const runReapply = async (runId: string) => {
    if (reapplyInflight) return
    reapplyInflight = true
    try {
      await runWatermarkReapply(runId, {
        db,
        storage,
        // Half the pipeline's width, floor 1: a background sweep must leave room for the
        // upload somebody is watching.
        pageConcurrency: Math.max(1, Math.floor(PAGE_CONCURRENCY / 2)),
      })
    } finally {
      reapplyInflight = false
    }
  }
  queue.process('watermark.reapply', async (job) => {
    await runReapply(job.data.runId)
  })

  // Views (docs/02 "Views and ranking"): fold `view_events` into the daily stats tables and
  // the denormalised counters, keep tomorrow's partition ready and drop the ones past 90
  // days. The producer is the scheduler tick below; the job exists as well so a backfill can
  // be asked for by hand (`from` / `to`) and so a redelivery is harmless — the rollup is
  // idempotent.
  queue.process('stats.rollup', async (job) => {
    await runStatsRollup(db, { from: job.data?.from, to: job.data?.to })
  })

  /**
   * `db.backup` (docs/17 §G, docs/18 §9). Same producer/handler split as `stats.rollup`: the
   * tick below is the nightly producer, and the job also exists so `Admin → System → Backup`
   * can enqueue one by hand. The app's own bucket is passed in so the destination guard can
   * refuse to write a dump into the bucket with the public CDN hostname attached — it is
   * resolved from the panel credentials, which is where the operator actually sets it.
   */
  const appBucket = async (): Promise<string | undefined> =>
    (await credentials())['s3.bucket']?.trim() || getEnv().S3_BUCKET
  queue.process('db.backup', async (job) => {
    lastBackup = Date.now()
    await runBackup(db, {
      trigger: job.data?.trigger ?? 'schedule',
      actorId: job.data?.actorId ?? null,
      appBucket: await appBucket(),
    })
  })

  /**
   * `sitemap.build` (docs/12 §5). Producer/handler split again: the tick is the nightly full
   * producer, the publish paths are the incremental producer through `sitemaps`, and the job
   * exists on its own so Admin → SEO could hand a rebuild to the worker instead of running it
   * inside a request. The builder is `apps/web/lib/seo/sitemaps.ts` — one implementation,
   * handed this process's database and storage (see the note at the top of that file).
   */
  queue.process('sitemap.build', async (job) => {
    if (job.data.kind === 'full') lastSitemap = Date.now()
    await runSitemapBuild({ db, storage }, { kind: job.data.kind, seriesIds: job.data.seriesIds })
  })

  for (const name of ['notify.comment', 'email.send', 'webhook.deliver'] as const) {
    queue.process(name, async (job) => {
      log.warn(`no handler for ${name} in apps/worker yet — acknowledged`, { id: job.id })
    })
  }
  // Pick the backup clock back up where the last run left it, so restarts do not re-dump.
  // No recorded run at all means "back this database up now", which is also how a fresh
  // deployment finds out whether the destination is configured.
  const recorded = await getSetting<BackupRun | null>(db, BACKUP_SETTING_KEY, null).catch(
    () => null,
  )
  const recordedAt = recorded?.finishedAt ? Date.parse(recorded.finishedAt) : Number.NaN
  lastBackup = Number.isNaN(recordedAt) ? 0 : recordedAt
  // Same for the nightly sitemap, read from `sitemap_builds` rather than a setting.
  const builtAt = await lastFullSitemapBuildAt(db).catch(() => null)
  lastSitemap = builtAt?.getTime() ?? 0

  const heartbeat = createHeartbeat({
    staleMs: heartbeatStaleMs(SCHEDULER_MS),
    queue: queue.kind,
    storage: storage.driver,
    onError: (err) => log.warn('heartbeat write failed', { error: String(err) }),
  })

  log.info('started', {
    queue: queue.kind,
    storage: storage.driver,
    concurrency: CONCURRENCY,
    heartbeat: heartbeat.file,
  })

  const tick = async () => {
    try {
      await publishPass()
      // Periodic jobs that live in the web app (account-deletion purges). Self-throttled.
      tasks.start('maintenance', () => runMaintenance())
      // The `stats.rollup` producer. Enqueued rather than called directly so a BullMQ
      // deployment does the work on whichever worker is free, and so the job shows up in
      // Admin → Jobs like every other one. `jobId` collapses a backlog into one pass.
      if (Date.now() - lastRollup >= ROLLUP_MS) {
        lastRollup = Date.now()
        await queue.add(
          'stats.rollup',
          {},
          { jobId: `stats.rollup:${Math.floor(Date.now() / ROLLUP_MS)}` },
        )
      }
      // The `db.backup` producer, on the same pattern. `lastBackup` moves when the job is
      // *enqueued* as well as when it runs, so a queue that is not draining cannot pile up
      // dumps behind it.
      if (Date.now() - lastBackup >= BACKUP_MS) {
        lastBackup = Date.now()
        await queue.add(
          'db.backup',
          { trigger: 'schedule' },
          { jobId: `db.backup:${Math.floor(Date.now() / BACKUP_MS)}` },
        )
      }
      // The nightly full `sitemap.build`, same pattern again. The incremental builds keep the
      // series and chapters files current between these; this one is what picks up everything
      // else — a genre renamed, an announcement published, a series unlisted — and repairs
      // anything an incremental build missed because the process died inside its window.
      if (Date.now() - lastSitemap >= SITEMAP_MS) {
        lastSitemap = Date.now()
        await queue.add(
          'sitemap.build',
          { kind: 'full' },
          { jobId: `sitemap.build:${Math.floor(Date.now() / SITEMAP_MS)}` },
        )
      }
      // safety net: processing rows that never started (no Redis / lost job) or stalled for 30 minutes
      const stale = await db
        .select({ id: chapters.id })
        .from(chapters)
        .where(
          and(
            eq(chapters.state, 'processing'),
            isNull(chapters.deletedAt),
            lt(
              chapters.updatedAt,
              new Date(Date.now() - (queue.kind === 'memory' ? 5_000 : 120_000)),
            ),
            sql`(${chapters.processing}->>'startedAt' is null or ${chapters.processing}->>'finishedAt' is null and (${chapters.processing}->>'startedAt')::timestamptz < now() - interval '30 minutes')`,
          ),
        )
        .limit(5)
      for (const s of stale) {
        log.warn('picking up stale processing chapter', { chapterId: s.id })
        tasks.start(`chapter.process ${s.id}`, () => run(s.id))
      }
      // A watermark re-apply whose worker died, or that was started with no queue behind it
      // (the web app's in-process queue does not survive a restart). The run row carries its
      // own cursor, so picking it back up costs at most the chapter it was on.
      const reapply = await readWatermarkRun(db).catch(() => null)
      if (
        reapply &&
        watermarkRunLive(reapply) &&
        !reapplyInflight &&
        Date.now() - Date.parse(reapply.heartbeatAt ?? reapply.startedAt) >
          (queue.kind === 'memory' ? 10_000 : 120_000)
      ) {
        log.warn('picking up a cold watermark re-apply', { runId: reapply.id })
        tasks.start(`watermark.reapply ${reapply.id}`, () => runReapply(reapply.id))
      }
      // cover / banner originals waiting for `series.art` (in-process web queue, lost job);
      // entries carrying an error are left for the admin to re-upload
      const art = await db
        .select({ id: series.id, artPending: series.artPending })
        .from(series)
        .where(
          and(
            isNotNull(series.artPending),
            isNull(series.deletedAt),
            lt(series.updatedAt, new Date(Date.now() - (queue.kind === 'memory' ? 5_000 : 60_000))),
          ),
        )
        .limit(10)
      for (const s of art) {
        for (const kind of ['cover', 'banner'] as const) {
          const entry = s.artPending?.[kind]
          if (entry && !entry.error)
            tasks.start(`series.art ${s.id}:${kind}`, () => runArt(s.id, kind))
        }
      }
      // Last, and only on the way out of a pass that did not throw: this file *is* the health
      // check (lib/health.ts), so a tick that keeps failing must let it go stale.
      await heartbeat.touch()
    } catch (err) {
      log.error('scheduler tick failed', err)
    }
  }
  await tick()
  const timer = setInterval(() => void tick(), SCHEDULER_MS)

  const shutdown = createShutdown({
    tasks,
    stopProducers: async () => {
      clearInterval(timer)
      notifications.stop()
      // Before the queue closes: a chapter published seconds ago still has its incremental
      // sitemap build waiting out its window, and after `queue.close()` nothing can be added.
      await sitemaps.flush()
      sitemaps.stop()
    },
    closeQueue: () => queue.close(),
    closeDb: () => closeDb(),
    timeoutMs: SHUTDOWN_TIMEOUT_MS,
    exit: (code) => process.exit(code),
  })
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => void shutdown(signal))
}

main().catch((err) => {
  log.error('fatal', err)
  process.exit(1)
})
