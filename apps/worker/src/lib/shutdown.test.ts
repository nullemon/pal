import { describe, expect, it } from 'vitest'
import { createBackgroundTasks } from './background.js'
import { createShutdown } from './shutdown.js'

/**
 * The deploy-mid-encode case. `shutdown()` used to clear the interval, close the queue and
 * the database and call `process.exit(0)` with a chapter still being encoded against both —
 * which left that chapter in `processing` until the 30-minute stale sweep. These check the
 * ordering that fixes it: nothing closes until the work has finished or the budget is spent.
 */
const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface Harness {
  order: string[]
  exitCode: number | undefined
}

const harness = () => {
  const order: string[] = []
  const state: Harness = { order, exitCode: undefined }
  return {
    state,
    closeQueue: async () => {
      order.push('queue')
    },
    closeDb: async () => {
      order.push('db')
    },
    exit: (code: number) => {
      order.push(`exit:${code}`)
      state.exitCode = code
    },
  }
}

describe('shutdown', () => {
  it('waits for an in-flight job before closing the queue or the database', async () => {
    const h = harness()
    const tasks = createBackgroundTasks()
    tasks.start('chapter.process 7', async () => {
      await later(120)
      h.state.order.push('chapter done')
    })

    await createShutdown({
      tasks,
      stopProducers: () => {
        h.state.order.push('producers stopped')
      },
      closeQueue: h.closeQueue,
      closeDb: h.closeDb,
      timeoutMs: 5_000,
      exit: h.exit,
    })('SIGTERM')

    expect(h.state.order).toEqual(['producers stopped', 'chapter done', 'queue', 'db', 'exit:0'])
  })

  it('stops producing before it waits, so nothing new is started mid-drain', async () => {
    const h = harness()
    const tasks = createBackgroundTasks()
    let acceptingWork = true

    await createShutdown({
      tasks,
      stopProducers: () => {
        acceptingWork = false
      },
      closeQueue: async () => {
        expect(acceptingWork).toBe(false)
        h.state.order.push('queue')
      },
      closeDb: h.closeDb,
      timeoutMs: 1_000,
      exit: h.exit,
    })('SIGTERM')

    expect(acceptingWork).toBe(false)
    expect(h.state.exitCode).toBe(0)
  })

  it('closes anyway when the drain runs out of budget, and says so with a non-zero exit', async () => {
    const h = harness()
    const tasks = createBackgroundTasks()
    tasks.start('wedged', () => new Promise<void>(() => {}))

    const started = Date.now()
    await createShutdown({
      tasks,
      stopProducers: () => {},
      closeQueue: h.closeQueue,
      closeDb: h.closeDb,
      timeoutMs: 60,
      exit: h.exit,
    })('SIGTERM')

    // It still closed everything — a stuck task must not leave connections open either.
    expect(h.state.order).toEqual(['queue', 'db', 'exit:1'])
    expect(Date.now() - started).toBeLessThan(3_000)
  })

  it('does not let a failed producer stop or a failed close block the exit', async () => {
    const h = harness()
    await createShutdown({
      tasks: createBackgroundTasks(),
      stopProducers: async () => {
        throw new Error('flush failed')
      },
      closeQueue: async () => {
        throw new Error('redis gone')
      },
      closeDb: async () => {
        throw new Error('pool already closed')
      },
      timeoutMs: 1_000,
      exit: h.exit,
    })('SIGTERM')

    expect(h.state.exitCode).toBe(1)
  })

  it('exits at once on a second signal', async () => {
    const h = harness()
    const tasks = createBackgroundTasks()
    tasks.start('slow', () => later(400))
    const shutdown = createShutdown({
      tasks,
      stopProducers: () => {},
      closeQueue: h.closeQueue,
      closeDb: h.closeDb,
      timeoutMs: 5_000,
      exit: h.exit,
    })

    const first = shutdown('SIGTERM')
    await shutdown('SIGINT')
    expect(h.state.exitCode).toBe(1)
    await first
  })
})
