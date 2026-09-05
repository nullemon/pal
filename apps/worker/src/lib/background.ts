import { log } from './log.js'

/**
 * The work the worker starts and does not await.
 *
 * The scheduler tick fires off chapter encodes, cover re-encodes, a watermark re-apply and
 * the web app's maintenance pass, none of which it can wait for — a tick that awaited a
 * chapter encode would stop publishing for the length of it. They used to be `void run(…)`,
 * which has two problems: a rejection has no handler (fatal on Node 22, see `lib/crash.ts`),
 * and `shutdown()` had no idea any of it existed. A deploy in the middle of an encode cleared
 * the interval, closed the database out from under the job and called `process.exit(0)`,
 * leaving that chapter in `processing` until the 30-minute stale sweep noticed.
 *
 * This registry fixes both: every unawaited call goes through `start()`, which attaches the
 * `.catch` and keeps the promise, and `drain()` waits for what is still running — bounded,
 * because "wait forever" is how a container gets SIGKILLed with the same chapter still stuck.
 */
export interface BackgroundTasks {
  /** Start work nobody awaits. Rejections are logged, never thrown. */
  start(label: string, run: () => Promise<unknown>): void
  /** Number of tasks still running. */
  readonly size: number
  /**
   * Wait for everything in flight, up to `timeoutMs`. Resolves `true` when the last one
   * finished, `false` when the timeout won — the caller decides what a stuck drain means.
   */
  drain(timeoutMs: number): Promise<boolean>
}

export const createBackgroundTasks = (
  opts: { onError?: (label: string, err: unknown) => void } = {},
): BackgroundTasks => {
  const onError =
    opts.onError ?? ((label: string, err: unknown) => log.error(`${label} failed`, err))
  const running = new Set<Promise<void>>()

  const tasks: BackgroundTasks = {
    start(label, run) {
      // Wrapped rather than called: a `run` that throws synchronously must land in the same
      // place as one that rejects, or it takes the tick down with it.
      const task = (async () => {
        try {
          await run()
        } catch (err) {
          onError(label, err)
        }
      })()
      running.add(task)
      void task.finally(() => {
        running.delete(task)
      })
    },
    get size() {
      return running.size
    },
    async drain(timeoutMs) {
      if (running.size === 0) return true
      let timer: ReturnType<typeof setTimeout> | undefined
      const expired = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs)
        timer.unref?.()
      })
      try {
        // Re-checked in a loop: a draining task may start another (a chapter that finishes
        // and revalidates), and the point is to leave nothing half-done.
        for (;;) {
          const settled = await Promise.race([
            Promise.allSettled([...running]).then(() => true as const),
            expired,
          ])
          if (settled === false) return false
          if (running.size === 0) return true
        }
      } finally {
        if (timer) clearTimeout(timer)
      }
    },
  }
  return tasks
}
