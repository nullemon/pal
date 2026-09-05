import { describe, expect, it, vi } from 'vitest'
import {
  COMPONENT_ORDER,
  collectStatus,
  type ProbeResults,
  type Probes,
  QUEUE_BACKLOG_LIMIT,
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
