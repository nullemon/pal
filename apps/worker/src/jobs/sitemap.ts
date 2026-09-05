import type { Queue } from '@palscans/core/queue'
import type { Storage } from '@palscans/core/storage'
import { type Db, sitemapBuilds } from '@palscans/db'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { buildSitemaps, type SitemapBuildResult } from '../../../web/lib/seo/sitemaps.js'
import { log } from '../lib/log.js'

/**
 * `sitemap.build` (docs/12 §5): "rebuilt fully nightly, and incrementally on every publish …
 * after each incremental build the worker submits the changed URLs via IndexNow".
 *
 * The builder itself lives in `apps/web/lib/seo/sitemaps.ts` and is imported from here the
 * same way the notification jobs import `apps/web/lib/notifications` — one implementation,
 * called from whichever process has the clock. This module is only the worker's half: the
 * environment knobs, the coalescer in front of the queue, and a handler that hands the
 * builder the worker's own database and storage.
 */

const sitemapEnvSchema = z.object({
  /**
   * `SITE_URL` is passed to the builder explicitly rather than letting it fall back to
   * `apps/web/lib/env.ts`, which asserts things about a *web server* (an https origin, a
   * declared proxy, a real INTERNAL_API_SECRET) that have nothing to do with this process.
   * Same reasoning as `jobs/notify-site.ts`.
   */
  SITE_URL: z.string().url().default('http://localhost:3000'),
  /** How often the scheduler enqueues a full rebuild. Mirrors WORKER_BACKUP_MS. */
  WORKER_SITEMAP_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(24 * 60 * 60 * 1000),
  /**
   * How long a publish waits for its neighbours before an incremental build is enqueued.
   * A release day publishes a dozen chapters in the same 30 s scheduler pass, and each one
   * would otherwise cost a full pair of series/chapters sitemap files (every published
   * chapter on the site, re-queried, re-gzipped, re-uploaded) plus its own IndexNow POST.
   * One window, one build, one submission with every changed URL in it.
   */
  WORKER_SITEMAP_DEBOUNCE_MS: z.coerce.number().int().positive().default(15_000),
})

export type SitemapEnv = z.infer<typeof sitemapEnvSchema>

let cachedEnv: SitemapEnv | undefined

export const sitemapEnv = (): SitemapEnv => {
  // Empty means unset, the same rule `apps/web/lib/env.ts` applies: `SITE_URL=` left blank in
  // a .env file must fall back to the default, not fail `.url()` and take the whole worker
  // down at import time over a setting only the sitemap job reads.
  cachedEnv ??= sitemapEnvSchema.parse(
    Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== '')),
  )
  return cachedEnv
}

/** Tests that mutate `process.env`. */
export const resetSitemapEnv = (): void => {
  cachedEnv = undefined
}

export interface SitemapDeps {
  db: Db
  storage: Storage
  siteUrl?: string
  /** Test hook, passed through to IndexNow. */
  fetchImpl?: typeof fetch
}

/**
 * Run one build and say what happened. Never throws: `buildSitemaps` records its own failure
 * on the `sitemap_builds` row and returns it, and a job that threw here would only be retried
 * into the same failure. The nightly full build is the repair path for anything an
 * incremental build missed.
 */
export const runSitemapBuild = async (
  deps: SitemapDeps,
  job: { kind: 'full' | 'incremental'; seriesIds?: number[] },
): Promise<SitemapBuildResult> => {
  const result = await buildSitemaps({
    kind: job.kind,
    seriesIds: job.seriesIds,
    db: deps.db,
    storage: deps.storage,
    siteUrl: deps.siteUrl ?? sitemapEnv().SITE_URL,
    fetchImpl: deps.fetchImpl,
  })
  if (result.error) {
    log.error(`sitemap.build ${job.kind} failed`, result.error)
    return result
  }
  log.info('sitemap.build done', {
    kind: result.kind,
    urls: result.urlCount,
    files: result.files.length,
    ms: result.finishedAt.getTime() - result.startedAt.getTime(),
    // `null` when there is no IndexNow key stored, which is the common case and not a fault.
    indexNow: result.indexNow ? `${result.indexNow.ok ? 'ok' : 'failed'}` : 'skipped',
    submitted: result.indexNow?.submitted ?? 0,
  })
  return result
}

/**
 * When the last full rebuild finished, so a restart does not start one.
 *
 * Same reasoning as `db.backup` seeding `lastBackup` from the recorded run: a full build
 * re-queries and re-uploads every section, and a worker that restarts twice during a deploy
 * must not pay for that twice. `null` — no successful full build has ever run — means "build
 * one now", which is also how a fresh install gets a sitemap without waiting until tomorrow.
 */
export const lastFullSitemapBuildAt = async (db: Db): Promise<Date | null> => {
  const [row] = await db
    .select({ finishedAt: sitemapBuilds.finishedAt })
    .from(sitemapBuilds)
    .where(
      and(
        eq(sitemapBuilds.kind, 'full'),
        isNull(sitemapBuilds.error),
        isNotNull(sitemapBuilds.finishedAt),
      ),
    )
    .orderBy(desc(sitemapBuilds.id))
    .limit(1)
  return row?.finishedAt ?? null
}

export interface SitemapCoalescer {
  /** A series whose pages changed. Enqueues one incremental build for the whole window. */
  note(seriesIds: readonly number[]): void
  /** Enqueue whatever is pending right now (the shutdown path, and tests). */
  flush(): Promise<void>
  /** Series ids waiting for the next window. */
  pending(): number[]
  stop(): void
}

/**
 * The publish → `sitemap.build` producer, with a debounce window in front of it.
 *
 * Publishes arrive in bursts: `publishDue` releases everything due in one 30 s pass, and a
 * chapter finishing its encode publishes on its own. Each of those is a *whole* rebuild of
 * the series and chapters sitemaps — the incremental part is which sections are rewritten,
 * not which rows are read — so enqueueing per chapter would do the same expensive work N
 * times and send N IndexNow submissions for one release.
 *
 * So ids accumulate for `debounceMs` and go out as one job. The window is not extended by
 * later notes (that would let a steady trickle starve the build forever); it starts at the
 * first note and fires once. The pending set only ever lives in this process, which is fine:
 * every id in it is also in the nightly full rebuild, so the worst case for a crash mid-window
 * is a chapter that waits for the nightly pass instead of a minute.
 */
export const createSitemapCoalescer = (
  queue: Queue,
  opts: { debounceMs?: number; onError?: (err: unknown) => void } = {},
): SitemapCoalescer => {
  const debounceMs = opts.debounceMs ?? sitemapEnv().WORKER_SITEMAP_DEBOUNCE_MS
  const onError = opts.onError ?? ((err: unknown) => log.error('sitemap.build enqueue failed', err))
  const waiting = new Set<number>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    if (waiting.size === 0) return
    const seriesIds = [...waiting].sort((a, b) => a - b)
    waiting.clear()
    try {
      await queue.add('sitemap.build', { kind: 'incremental', seriesIds })
      log.info('sitemap.build enqueued', { kind: 'incremental', series: seriesIds.length })
    } catch (err) {
      onError(err)
    }
  }

  return {
    note(seriesIds) {
      let added = false
      for (const id of seriesIds) {
        if (Number.isFinite(id) && !waiting.has(id)) {
          waiting.add(id)
          added = true
        }
      }
      if (!added || timer) return
      timer = setTimeout(() => {
        timer = undefined
        void flush()
      }, debounceMs)
      timer.unref?.()
    },
    flush,
    pending: () => [...waiting],
    stop() {
      if (timer) clearTimeout(timer)
      timer = undefined
    },
  }
}
