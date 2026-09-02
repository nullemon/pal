import { getQueue } from '@palscans/core/queue'
import { getStorage } from '@palscans/core/storage'
import { chapters, closeDb, getDb } from '@palscans/db'
import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import { processChapter } from './jobs/chapter-process.js'
import { publishDue } from './jobs/publish.js'
import { log } from './lib/log.js'

/**
 * The PALScans worker (docs/16 "apps/worker"): the image pipeline (`chapter.process`), the
 * publish scheduler (every 30 s), and a safety net that picks up `processing` chapters no
 * job ever reached (the web app runs an in-process queue when REDIS_URL is unset).
 */
const SCHEDULER_MS = Number(process.env.WORKER_SCHEDULER_MS ?? 30_000)
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 1)
const PAGE_CONCURRENCY = Number(process.env.WORKER_PAGE_CONCURRENCY ?? 4)

const main = async () => {
  const db = await getDb()
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
  queue.process('chapter.publish', async (job) => {
    await publishDue(db)
    log.info('chapter.publish handled by the scheduler pass', { chapterId: job.data.chapterId })
  })
  // The shared queue carries every job name (docs/16); the ones outside this scope are
  // acknowledged with a log line so they never pile up as failures. Integration wires them.
  for (const name of [
    'sitemap.build',
    'notify.new_chapter',
    'notify.comment',
    'email.send',
    'stats.rollup',
    'webhook.deliver',
  ] as const) {
    queue.process(name, async (job) => {
      log.warn(`no handler for ${name} in apps/worker yet — acknowledged`, { id: job.id })
    })
  }
  log.info('started', { queue: queue.kind, storage: storage.driver, concurrency: CONCURRENCY })

  const tick = async () => {
    try {
      await publishDue(db)
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
    } catch (err) {
      log.error('scheduler tick failed', err)
    }
  }
  await tick()
  const timer = setInterval(() => void tick(), SCHEDULER_MS)

  const shutdown = async () => {
    clearInterval(timer)
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
