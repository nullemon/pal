import { describe, expect, it } from 'vitest'
import { createBackgroundTasks } from './background.js'

/**
 * The registry behind the worker's unawaited work. Two properties matter and both used to be
 * absent: a task that rejects must not reach the process (Node 22 exits on an unhandled
 * rejection), and `shutdown()` must wait for what is still running instead of closing the
 * database out from under a chapter encode.
 */
const later = <T>(ms: number, value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms))

describe('background tasks', () => {
  it('waits for work that is still running before the drain resolves', async () => {
    const tasks = createBackgroundTasks()
    let finished = false
    tasks.start('slow', async () => {
      await later(120, null)
      finished = true
    })
    expect(tasks.size).toBe(1)

    const drained = await tasks.drain(5_000)

    expect(drained).toBe(true)
    expect(finished).toBe(true)
    expect(tasks.size).toBe(0)
  })

  it('waits for work a draining task started itself', async () => {
    const tasks = createBackgroundTasks()
    let second = false
    tasks.start('first', async () => {
      await later(20, null)
      tasks.start('second', async () => {
        await later(40, null)
        second = true
      })
    })

    expect(await tasks.drain(5_000)).toBe(true)
    expect(second).toBe(true)
  })

  it('gives up on the timeout rather than holding the shutdown open forever', async () => {
    const tasks = createBackgroundTasks()
    // Nothing resolves this: a job wedged on a socket that will never answer.
    tasks.start('wedged', () => new Promise<void>(() => {}))

    const started = Date.now()
    const drained = await tasks.drain(60)

    expect(drained).toBe(false)
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(tasks.size).toBe(1)
  })

  it('reports a rejected task instead of letting it reach the process', async () => {
    const seen: Array<{ label: string; message: string }> = []
    const tasks = createBackgroundTasks({
      onError: (label, err) => seen.push({ label, message: (err as Error).message }),
    })

    tasks.start('rejects', async () => {
      throw new Error('postgres went away')
    })
    // A synchronous throw has to land in the same place as a rejection.
    tasks.start('throws', () => {
      throw new Error('sync boom')
    })

    expect(await tasks.drain(5_000)).toBe(true)
    expect([...seen].sort((a, b) => a.label.localeCompare(b.label))).toEqual([
      { label: 'rejects', message: 'postgres went away' },
      { label: 'throws', message: 'sync boom' },
    ])
  })

  it('drains immediately when nothing is running', async () => {
    const tasks = createBackgroundTasks()
    expect(await tasks.drain(0)).toBe(true)
  })
})
