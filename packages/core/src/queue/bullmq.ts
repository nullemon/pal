import { Queue as BullQueue, Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { getEnv } from '../env.js'
import type { Job, JobHandler, JobMap, JobName, JobOptions, Queue, QueueStats } from './types.js'

export interface BullQueueOptions {
  name?: string
  redisUrl?: string
  prefix?: string
}

/** BullMQ-backed queue; one BullMQ queue per logical queue, job names as BullMQ job names. */
export class BullMqQueue implements Queue {
  readonly kind = 'bullmq' as const
  readonly name: string
  private readonly connection: Redis
  private readonly queue: BullQueue
  private readonly workers: Worker[] = []
  private readonly handlers = new Map<JobName, JobHandler<JobName>>()

  constructor(opts: BullQueueOptions = {}) {
    this.name = opts.name ?? 'palscans'
    const url = opts.redisUrl ?? getEnv().REDIS_URL
    if (!url) throw new Error('REDIS_URL is required for the BullMQ queue')
    this.connection = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true })
    this.queue = new BullQueue(this.name, {
      connection: this.connection,
      prefix: opts.prefix ?? 'palscans',
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    })
  }

  async add<N extends JobName>(name: N, data: JobMap[N], opts: JobOptions = {}): Promise<string> {
    const job = await this.queue.add(name, data, {
      delay: opts.delayMs,
      jobId: opts.jobId,
      attempts: opts.attempts,
      priority: opts.priority,
    })
    return String(job.id ?? job.name)
  }

  process<N extends JobName>(name: N, handler: JobHandler<N>, concurrency = 1): void {
    this.handlers.set(name, handler as JobHandler<JobName>)
    // One worker per queue is enough: it dispatches by job name.
    if (this.workers.length === 0) {
      const worker = new Worker(
        this.name,
        async (bullJob) => {
          const h = this.handlers.get(bullJob.name as JobName)
          if (!h) throw new Error(`No handler registered for job ${bullJob.name}`)
          const job: Job = {
            id: String(bullJob.id ?? ''),
            name: bullJob.name as JobName,
            data: bullJob.data as JobMap[JobName],
            attemptsMade: bullJob.attemptsMade,
          }
          await h(job)
        },
        {
          connection: this.connection.duplicate(),
          prefix: 'palscans',
          concurrency,
        },
      )
      this.workers.push(worker)
    }
  }

  async stats(): Promise<QueueStats> {
    const c = await this.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed')
    return {
      waiting: c.waiting ?? 0,
      active: c.active ?? 0,
      completed: c.completed ?? 0,
      failed: c.failed ?? 0,
      delayed: c.delayed ?? 0,
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()))
    await this.queue.close()
    await this.connection.quit().catch(() => undefined)
  }
}
