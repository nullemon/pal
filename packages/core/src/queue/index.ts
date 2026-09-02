import { getEnv } from '../env.js'
import { MemoryQueue } from './memory.js'
import type { Queue } from './types.js'

export * from './memory.js'
export * from './types.js'

export interface CreateQueueOptions {
  name?: string
  /** Force a kind; default: bullmq when REDIS_URL is set, memory otherwise. */
  kind?: 'memory' | 'bullmq'
  redisUrl?: string
}

/**
 * BullMQ (and ioredis) are loaded lazily so importing `@palscans/core` from the web app
 * does not pull the Redis client into every bundle.
 */
export const createQueue = async (opts: CreateQueueOptions = {}): Promise<Queue> => {
  const redisUrl = opts.redisUrl ?? getEnv().REDIS_URL
  const kind = opts.kind ?? (redisUrl ? 'bullmq' : 'memory')
  if (kind === 'bullmq') {
    const { BullMqQueue } = await import('./bullmq.js')
    return new BullMqQueue({ name: opts.name, redisUrl })
  }
  return new MemoryQueue(opts.name)
}

let shared: Promise<Queue> | undefined
/** Process-wide queue built from the environment on first use. */
export const getQueue = (): Promise<Queue> => {
  shared ??= createQueue()
  return shared
}
