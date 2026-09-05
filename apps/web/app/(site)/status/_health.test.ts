import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMPONENT_ORDER,
  cachedStatus,
  collectStatus,
  type ProbeResults,
  type Probes,
  QUEUE_BACKLOG_LIMIT,
  resetStatusCache,
  STATUS_TTL_MS,
  summarise,
  WORKER_HEARTBEAT_MAX_MS,
  withTimeout,
} from './_health'

const allGood: ProbeResults = {
  database: true,
  cache: true,
  storage: true,
  queueBacklog: 0,
  workerHeartbeatAge: 1_000,
}

const stateOf = (results: Partial<ProbeResults>) => {
  const snapshot = summarise({ ...allGood, ...results })
  return Object.fromEntries(snapshot.components.map((c) => [c.id, c.state]))
}

describe('summarise', () => {
  it('reports every component in a fixed order, and nothing else', () => {
    const snapshot = summarise(allGood, new Date('2026-09-05T10:00:00Z'))
    expect(snapshot.components.map((c) => c.id)).toEqual([...COMPONENT_ORDER])
    expect(snapshot.overall).toBe('operational')
    expect(snapshot.checkedAt).toBe('2026-09-05T10:00:00.000Z')
    // The wire shape is the whole promise of the page: two words and a time.
    expect(Object.keys(snapshot).sort()).toEqual(['checkedAt', 'components', 'overall'])
    for (const component of snapshot.components)
      expect(Object.keys(component).sort()).toEqual(['id', 'state'])
  })

  it('degrades the component that failed, and only that one', () => {
    expect(stateOf({ database: false })).toMatchObject({
      database: 'degraded',
      cache: 'operational',
      storage: 'operational',
    })
    expect(stateOf({ cache: false })).toMatchObject({
      cache: 'degraded',
      database: 'operational',
    })
    expect(stateOf({ storage: false })).toMatchObject({ storage: 'degraded' })
  })

  it('degrades overall as soon as one component is degraded', () => {
    expect(summarise({ ...allGood, storage: false }).overall).toBe('degraded')
    expect(summarise(allGood).overall).toBe('operational')
  })

  it('reads the queue by its backlog, and treats an unanswerable queue as degraded', () => {
    expect(stateOf({ queueBacklog: QUEUE_BACKLOG_LIMIT })).toMatchObject({ queue: 'operational' })
    expect(stateOf({ queueBacklog: QUEUE_BACKLOG_LIMIT + 1 })).toMatchObject({
      queue: 'degraded',
    })
    expect(stateOf({ queueBacklog: null })).toMatchObject({ queue: 'degraded' })
  })

  it('reads the worker by the age of its heartbeat', () => {
    expect(stateOf({ workerHeartbeatAge: WORKER_HEARTBEAT_MAX_MS })).toMatchObject({
      worker: 'operational',
    })
    expect(stateOf({ workerHeartbeatAge: WORKER_HEARTBEAT_MAX_MS + 1 })).toMatchObject({
      worker: 'degraded',
    })
    expect(stateOf({ workerHeartbeatAge: null })).toMatchObject({ worker: 'degraded' })
  })
})

describe('collectStatus', () => {
  const probes = (over: Partial<Probes> = {}): Probes => ({
    database: async () => true,
    cache: async () => true,
    storage: async () => true,
    queueBacklog: async () => 0,
    workerHeartbeatAge: async () => 0,
    ...over,
  })

  it('runs the probes and reduces them to a snapshot', async () => {
    const snapshot = await collectStatus(probes())
    expect(snapshot.overall).toBe('operational')
  })

  it('says the database is down without ever reaching a database', async () => {
    const snapshot = await collectStatus(probes({ database: async () => false }))
    expect(snapshot.overall).toBe('degraded')
    expect(snapshot.components.find((c) => c.id === 'database')?.state).toBe('degraded')
  })

  it('runs the probes in parallel, so one slow dependency does not stack on the rest', async () => {
    const started: string[] = []
    let open: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    const snapshotPromise = collectStatus(
      probes({
        database: async () => {
          started.push('database')
          await gate
          return true
        },
        storage: async () => {
          started.push('storage')
          return true
        },
      }),
    )
    await Promise.resolve()
    expect(started).toContain('storage')
    open()
    expect((await snapshotPromise).overall).toBe('operational')
  })
})

describe('withTimeout', () => {
  it('returns the fallback when the probe throws', async () => {
    expect(
      await withTimeout(async () => {
        throw new Error('connection refused: 10.0.0.7:6379')
      }, false),
    ).toBe(false)
  })

  it('returns the fallback when the probe never answers', async () => {
    vi.useFakeTimers()
    try {
      const pending = withTimeout(() => new Promise<boolean>(() => undefined), false, 50)
      await vi.advanceTimersByTimeAsync(60)
      expect(await pending).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns the value when the probe answers in time', async () => {
    expect(await withTimeout(async () => 7, null, 1_000)).toBe(7)
  })
})

describe('cachedStatus', () => {
  /** Probes that count how many rounds actually ran. */
  const counting = () => {
    const runs = { storage: 0 }
    const probes: Probes = {
      database: async () => true,
      cache: async () => true,
      storage: async () => {
        runs.storage++
        return true
      },
      queueBacklog: async () => 0,
      workerHeartbeatAge: async () => 0,
    }
    return { probes, runs }
  }

  /** A clock the test drives, so a twelve-second TTL does not take twelve seconds. */
  const clock = () => {
    let t = 1_800_000_000_000
    return { now: () => t, advance: (ms: number) => (t += ms) }
  }

  beforeEach(() => resetStatusCache())

  it('probes once and answers the next request from the memo', async () => {
    const { probes, runs } = counting()
    const time = clock()
    const first = await cachedStatus(probes, time.now)
    time.advance(STATUS_TTL_MS - 1)
    const second = await cachedStatus(probes, time.now)
    // The storage probe is a billed HTTPS round trip to R2 in production. One, not two.
    expect(runs.storage).toBe(1)
    expect(second.checkedAt).toBe(first.checkedAt)
  })

  it('probes again once the memo is stale, so an outage still shows', async () => {
    const { probes, runs } = counting()
    const time = clock()
    await cachedStatus(probes, time.now)
    time.advance(STATUS_TTL_MS + 1)
    await cachedStatus(probes, time.now)
    expect(runs.storage).toBe(2)
  })

  it('gives a burst of simultaneous readers one round of probes between them', async () => {
    const { probes, runs } = counting()
    const time = clock()
    // The shape of a traffic spike on a cold memo: a TTL alone would let every one of these
    // start a round of its own before the first finished.
    const snapshots = await Promise.all(
      Array.from({ length: 50 }, () => cachedStatus(probes, time.now)),
    )
    expect(runs.storage).toBe(1)
    expect(new Set(snapshots.map((s) => s.checkedAt)).size).toBe(1)
  })

  it('leaves nothing memoised when a round fails outright', async () => {
    const time = clock()
    let calls = 0
    const probes: Probes = {
      database: async () => {
        calls++
        if (calls === 1) throw new Error('boom')
        return true
      },
      cache: async () => true,
      storage: async () => true,
      queueBacklog: async () => 0,
      workerHeartbeatAge: async () => 0,
    }
    // `defaultProbes` catch inside themselves, so this is the belt-and-braces case: if a
    // round ever does reject, the in-flight promise must not be left behind for the next
    // reader to await — that would memoise the failure until the process restarts.
    await expect(cachedStatus(probes, time.now)).rejects.toThrow('boom')
    expect((await cachedStatus(probes, time.now)).overall).toBe('operational')
  })
})
