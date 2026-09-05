import { getQueue } from '@palscans/core/queue'
import { getDb } from '@palscans/db'
import { sql } from 'drizzle-orm'
import { getStorage } from '@/lib/storage'

/**
 * The public status page's checks (docs/17 §G "a `/status` link and the uptime page",
 * docs/13 "Status page").
 *
 * Two rules shape everything here:
 *
 *  1. **It says nothing about the infrastructure.** A reader gets `operational` or
 *     `degraded` per component and a timestamp. No hostnames, drivers, versions, queue
 *     depths, error text or "not configured" — a status page is served to everyone,
 *     including whoever is looking for a way in. Numbers like the queue backlog are inputs
 *     to a check, never outputs of one.
 *  2. **A check that cannot run is a check that failed.** Every probe is wrapped in a
 *     timeout and a catch, so the page can say "the database is down" without the database:
 *     nothing on this route reads from it except the database probe itself.
 */

export type ComponentId = 'database' | 'cache' | 'storage' | 'queue' | 'worker'
export type ComponentState = 'operational' | 'degraded'

export interface ComponentStatus {
  id: ComponentId
  state: ComponentState
}

export interface StatusSnapshot {
  overall: ComponentState
  components: ComponentStatus[]
  /** ISO instant; rendered client-side in the viewer's zone like every other time. */
  checkedAt: string
}

export const COMPONENT_ORDER: readonly ComponentId[] = [
  'database',
  'cache',
  'storage',
  'queue',
  'worker',
]

/** Jobs waiting for a worker before the backlog is worth telling readers about. */
export const QUEUE_BACKLOG_LIMIT = 250

/**
 * How stale the worker's heartbeat may be. BullMQ workers refresh their stalled-check key
 * every `stalledInterval` (30 s), so three missed ticks is a worker that is gone rather
 * than a worker that was busy.
 */
export const WORKER_HEARTBEAT_MAX_MS = 90_000

/** Nothing is written or read back; only the round trip to the object store is the check. */
const STORAGE_PROBE_KEY = 'status/probe'

/**
 * The key a BullMQ worker refreshes while it is alive. It mirrors the queue built in
 * `packages/core/src/queue/bullmq.ts` (prefix `palscans`, queue `palscans`) and the key
 * layout BullMQ uses, `<prefix>:<queue>:<key>`. Its value is the epoch-ms of the last
 * stalled check, which makes it a heartbeat with an age rather than a bare flag.
 */
export const WORKER_HEARTBEAT_KEY = 'palscans:palscans:stalled-check'

/** Every probe gets the same short leash: a slow dependency is a degraded dependency. */
export const PROBE_TIMEOUT_MS = 2_500

export interface ProbeResults {
  database: boolean
  cache: boolean
  storage: boolean
  /** Jobs waiting for a worker, or null when the queue could not be asked. */
  queueBacklog: number | null
  /** Age of the worker's last heartbeat in ms, or null when there is none. */
  workerHeartbeatAge: number | null
}

export interface Probes {
  database(): Promise<boolean>
  cache(): Promise<boolean>
  storage(): Promise<boolean>
  queueBacklog(): Promise<number | null>
  workerHeartbeatAge(): Promise<number | null>
}

/** Resolve to `fallback` rather than hanging when a dependency stops answering. */
export const withTimeout = async <T>(
  work: () => Promise<T>,
  fallback: T,
  ms = PROBE_TIMEOUT_MS,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work(),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms)
      }),
    ])
  } catch {
    return fallback
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Turn raw probe results into the two words the page is allowed to show. */
export const summarise = (results: ProbeResults, at: Date = new Date()): StatusSnapshot => {
  const state = (ok: boolean): ComponentState => (ok ? 'operational' : 'degraded')
  const components: ComponentStatus[] = [
    { id: 'database', state: state(results.database) },
    { id: 'cache', state: state(results.cache) },
    { id: 'storage', state: state(results.storage) },
    {
      id: 'queue',
      state: state(results.queueBacklog !== null && results.queueBacklog <= QUEUE_BACKLOG_LIMIT),
    },
    {
      id: 'worker',
      state: state(
        results.workerHeartbeatAge !== null &&
          results.workerHeartbeatAge <= WORKER_HEARTBEAT_MAX_MS,
      ),
    },
  ]
  const byId = new Map(components.map((c) => [c.id, c]))
  const ordered = COMPONENT_ORDER.flatMap((id) => {
    const found = byId.get(id)
    return found ? [found] : []
  })
  return {
    overall: ordered.every((c) => c.state === 'operational') ? 'operational' : 'degraded',
    components: ordered,
    checkedAt: at.toISOString(),
  }
}

/* ------------------------------------------------------------------ real probes ------ */

type RedisProbe = {
  ping(): Promise<string>
  get(key: string): Promise<string | null>
}

let redisProbe: Promise<RedisProbe | null> | undefined

/**
 * A connection of this route's own rather than `lib/auth/redis`, which memoises `null` for
 * the life of the process the first time it cannot connect — exactly the answer a status
 * page must never cache. A failed attempt here is discarded so the next request retries,
 * and a live client is kept so the page costs one round trip, not one handshake.
 */
const probeRedis = async (): Promise<RedisProbe | null> => {
  const url = process.env.REDIS_URL
  if (!url) return null
  redisProbe ??= import('ioredis')
    .then(async ({ Redis }) => {
      const client = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 1_500,
      })
      client.on('error', () => undefined)
      await client.connect()
      return client as unknown as RedisProbe
    })
    .catch(() => {
      redisProbe = undefined
      return null
    })
  return redisProbe
}

/** Tests and the dev server: drop the probe connection so the next check reconnects. */
export const resetProbeRedis = (): void => {
  redisProbe = undefined
}

export const defaultProbes: Probes = {
  async database() {
    return withTimeout(async () => {
      const db = await getDb()
      await db.execute(sql`select 1`)
      return true
    }, false)
  },

  /**
   * With no Redis the app caches in process, and a process that is answering this request
   * has a working cache — so the honest answer is "operational", not "not configured".
   */
  async cache() {
    return withTimeout(async () => {
      if (!process.env.REDIS_URL) return true
      const client = await probeRedis()
      if (!client) return false
      await client.ping()
      return true
    }, false)
  },

  /**
   * A HEAD for an object that does not exist: it exercises the driver, the bucket and the
   * credentials without writing anything. `null` (missing) is a pass; only a throw is not.
   */
  async storage() {
    return withTimeout(async () => {
      const storage = await getStorage()
      await storage.head(STORAGE_PROBE_KEY)
      return true
    }, false)
  },

  async queueBacklog() {
    return withTimeout<number | null>(async () => {
      const queue = await getQueue()
      const stats = await queue.stats()
      return stats.waiting
    }, null)
  },

  /**
   * With Redis, the age of the BullMQ worker's last stalled check. Without it, the queue
   * runs inside this process, so the thing that would consume jobs is the thing answering
   * this request: age zero.
   */
  async workerHeartbeatAge() {
    return withTimeout<number | null>(async () => {
      if (!process.env.REDIS_URL) return 0
      const client = await probeRedis()
      if (!client) return null
      const raw = await client.get(WORKER_HEARTBEAT_KEY)
      const at = raw === null ? Number.NaN : Number(raw)
      if (!Number.isFinite(at)) return null
      return Math.max(0, Date.now() - at)
    }, null)
  },
}

/** Run every probe in parallel and reduce them to the page's snapshot. */
export const collectStatus = async (probes: Probes = defaultProbes): Promise<StatusSnapshot> => {
  const [database, cache, storage, queueBacklog, workerHeartbeatAge] = await Promise.all([
    probes.database(),
    probes.cache(),
    probes.storage(),
    probes.queueBacklog(),
    probes.workerHeartbeatAge(),
  ])
  return summarise({ database, cache, storage, queueBacklog, workerHeartbeatAge })
}
