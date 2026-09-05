/**
 * One Queue interface: BullMQ when REDIS_URL is set, an in-process MemoryQueue otherwise.
 * Job names and payloads are typed through `JobMap` so producers and workers agree.
 */
export interface JobMap {
  'chapter.process': { chapterId: number }
  'chapter.publish': { chapterId: number }
  /** Re-encode an uploaded cover / banner original into the public variants (docs/03). */
  'series.art': { seriesId: number; kind: 'cover' | 'banner'; key: string }
  'sitemap.build': { kind: 'full' | 'incremental'; seriesIds?: number[] }
  'notify.new_chapter': { chapterId: number }
  'notify.comment': { commentId: number; kind: 'reply' | 'mention' | 'reaction' }
  'email.send': { to: string; template: string; vars: Record<string, string> }
  /**
   * Roll `view_events` into the daily stats tables and the denormalised view counters
   * (docs/02). Empty payload = the default trailing window; `from` / `to` (YYYY-MM-DD) ask
   * for a backfill over a wider one.
   */
  'stats.rollup': { from?: string; to?: string }
  'webhook.deliver': { webhookId: number; event: string; payload: Record<string, unknown> }
  /** Walk the legacy WordPress site and import it, one resumable batch at a time (docs/17 §E). */
  'import.run': { runId: number }
  /**
   * Dump the database, verify it with `pg_restore -l`, upload it to the private backups
   * bucket and prune the retention window (docs/17 §G, docs/18 §9). The scheduler is the
   * usual producer; `Admin → System → Backup` enqueues the same job with `trigger: 'manual'`.
   */
  'db.backup': { trigger?: 'schedule' | 'manual'; actorId?: number }
}
export type JobName = keyof JobMap

export interface JobOptions {
  /** Delay in ms before the job becomes runnable. */
  delayMs?: number
  /** Dedupe: a second add with the same id while the first is pending is ignored. */
  jobId?: string
  attempts?: number
  priority?: number
}

export interface Job<N extends JobName = JobName> {
  id: string
  name: N
  data: JobMap[N]
  attemptsMade: number
}

export type JobHandler<N extends JobName> = (job: Job<N>) => Promise<void>

export interface QueueStats {
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}

export interface Queue {
  readonly kind: 'memory' | 'bullmq'
  readonly name: string
  add<N extends JobName>(name: N, data: JobMap[N], opts?: JobOptions): Promise<string>
  /** Register a handler for a job name; starts processing. */
  process<N extends JobName>(name: N, handler: JobHandler<N>, concurrency?: number): void
  stats(): Promise<QueueStats>
  /** Waits for in-flight jobs to finish, then releases connections. */
  close(): Promise<void>
}
