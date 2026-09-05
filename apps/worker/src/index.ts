import { getEnv } from '@palscans/core/env'
import { getQueue } from '@palscans/core/queue'
import { getStorage } from '@palscans/core/storage'
import { chapters, closeDb, getDb, getSetting, series } from '@palscans/db'
import { and, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { BACKUP_SETTING_KEY, type BackupRun, backupEnv, runBackup } from './jobs/backup.js'
import { processChapter } from './jobs/chapter-process.js'
import { openSource, readImportConfig } from './jobs/import/resolve.js'
import { runImport } from './jobs/import-run.js'
import { registerNotifications } from './jobs/notify-index.js'
import { publishDue } from './jobs/publish.js'
import { type ArtKind, processSeriesArt } from './jobs/series-art.js'
import { runStatsRollup } from './jobs/stats-rollup.js'
import { installWorkerConfig } from './lib/config.js'
import { log } from './lib/log.js'
import { revalidateWeb, runMaintenance } from './lib/revalidate.js'

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
const CONCURRENCY = getEnv().WORKER_CONCURRENCY
const PAGE_CONCURRENCY = getEnv().WORKER_PAGE_CONCURRENCY

const main = async () => {
  const db = await getDb()
  // docs/19: point storage — and the credentials the notification jobs read — at what the
  // operator typed into the admin panel, before anything asks for a bucket. With nothing
  // stored (or no database) every one of them falls back to the environment.
  const credentials = installWorkerConfig(db)
  const storage = await getStorage()
  const queue = await getQueue()
  const deps = { db, storage, pageConcurrency: PAGE_CONCURRENCY }
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
    if ((await publishDue(db)).length) await revalidateWeb(['catalog'])
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

  for (const name of [
    'sitemap.build',
    'notify.comment',
    'email.send',
    'webhook.deliver',
  ] as const) {
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

  log.info('started', { queue: queue.kind, storage: storage.driver, concurrency: CONCURRENCY })

  const tick = async () => {
    try {
      if ((await publishDue(db)).length) await revalidateWeb(['catalog'])
      // Periodic jobs that live in the web app (account-deletion purges). Self-throttled.
      void runMaintenance()
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
        void run(s.id)
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
          if (entry && !entry.error) void runArt(s.id, kind)
        }
      }
    } catch (err) {
      log.error('scheduler tick failed', err)
    }
  }
  await tick()
  const timer = setInterval(() => void tick(), SCHEDULER_MS)

  const shutdown = async () => {
    clearInterval(timer)
    notifications.stop()
    log.info('shutting down')
    await queue.close()
    await closeDb()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

main().catch((err) => {
  log.error('fatal', err)
  process.exit(1)
})
