import type { Job, JobHandler, JobMap, JobName, JobOptions, Queue, QueueStats } from './types.js'

interface Pending {
  job: Job
  runAt: number
  attempts: number
  timer?: ReturnType<typeof setTimeout>
}

type AnyHandler = (job: Job) => Promise<void>

/**
 * In-process queue for local development and tests. Jobs run on the event loop with
 * the requested concurrency; delayed jobs use timers; failures retry up to `attempts`.
 */
export class MemoryQueue implements Queue {
  readonly kind = 'memory' as const
  readonly name: string
  private handlers = new Map<JobName, { handler: AnyHandler; concurrency: number }>()
  private pending = new Map<string, Pending>()
  private active = new Map<JobName, number>()
  private counters = { completed: 0, failed: 0 }
  private seq = 0
  private closed = false
  private inflight = new Set<Promise<void>>()
  readonly failures: Array<{ job: Job; error: unknown }> = []

  constructor(name = 'palscans') {
    this.name = name
  }

  async add<N extends JobName>(name: N, data: JobMap[N], opts: JobOptions = {}): Promise<string> {
    if (this.closed) throw new Error('queue closed')
    const id = opts.jobId ?? `${name}:${++this.seq}`
    if (this.pending.has(id)) return id
    const job: Job = { id, name, data, attemptsMade: 0 }
    const entry: Pending = {
      job,
      runAt: Date.now() + (opts.delayMs ?? 0),
      attempts: Math.max(1, opts.attempts ?? 1),
    }
    this.pending.set(id, entry)
    if (opts.delayMs && opts.delayMs > 0) this.schedule(name, entry)
    else queueMicrotask(() => this.pump(name))
    return id
  }

  process<N extends JobName>(name: N, handler: JobHandler<N>, concurrency = 1): void {
    this.handlers.set(name, { handler: handler as AnyHandler, concurrency })
    queueMicrotask(() => this.pump(name))
  }

  private schedule(name: JobName, entry: Pending): void {
    if (entry.timer) return
    const wait = Math.max(1, entry.runAt - Date.now())
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      this.pump(name)
    }, wait)
    entry.timer.unref?.()
  }

  private pump(name: JobName): void {
    const h = this.handlers.get(name)
    if (!h || this.closed) return
    const now = Date.now()
    for (const [id, entry] of this.pending) {
      if (entry.job.name !== name) continue
      if (entry.runAt > now) {
        this.schedule(name, entry)
        continue
      }
      if ((this.active.get(name) ?? 0) >= h.concurrency) return
      this.pending.delete(id)
      if (entry.timer) clearTimeout(entry.timer)
      entry.timer = undefined
      this.active.set(name, (this.active.get(name) ?? 0) + 1)
      const run = h
        .handler(entry.job)
        .then(() => {
          this.counters.completed++
        })
        .catch((error: unknown) => {
          entry.job.attemptsMade++
          if (entry.job.attemptsMade < entry.attempts) {
            entry.runAt = Date.now() + 50 * 2 ** entry.job.attemptsMade
            this.pending.set(id, entry)
            this.schedule(name, entry)
          } else {
            this.counters.failed++
            this.failures.push({ job: entry.job, error })
          }
        })
        .finally(() => {
          this.active.set(name, (this.active.get(name) ?? 1) - 1)
          this.inflight.delete(run)
          this.pump(name)
        })
      this.inflight.add(run)
    }
  }

  async stats(): Promise<QueueStats> {
    const now = Date.now()
    let waiting = 0
    let delayed = 0
    for (const p of this.pending.values())
      if (p.runAt > now) delayed++
      else waiting++
    let active = 0
    for (const n of this.active.values()) active += n
    return { waiting, active, delayed, ...this.counters }
  }

  /** Resolve once every runnable job has finished (tests). */
  async drain(): Promise<void> {
    for (;;) {
      await Promise.allSettled([...this.inflight])
      for (const name of this.handlers.keys()) this.pump(name)
      const runnable = [...this.pending.values()].some(
        (p) => p.runAt <= Date.now() && this.handlers.has(p.job.name),
      )
      if (this.inflight.size === 0 && !runnable) return
      await new Promise((r) => setTimeout(r, 5))
    }
  }

  async close(): Promise<void> {
    this.closed = true
    for (const p of this.pending.values()) if (p.timer) clearTimeout(p.timer)
    await Promise.allSettled([...this.inflight])
  }
}
