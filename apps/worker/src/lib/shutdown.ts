import type { BackgroundTasks } from './background.js'
import { log } from './log.js'

/**
 * SIGTERM handling for the worker: stop taking work, let what is running finish, then close.
 *
 * What it replaces cleared the interval, closed the queue and the database and called
 * `process.exit(0)` — while a chapter encode started by the tick was still writing to both.
 * A deploy in the middle of one left that chapter in `processing` until the 30-minute stale
 * sweep noticed, every time, and the reader watching the progress bar saw it stop.
 *
 * The shape is `apps/web/scripts/serve.mjs`, which is the best-thought-out file in this
 * deployment: drain with a bound, force past whatever is still stuck, and be explicit about
 * which of the two happened. A second signal skips the wait — someone holding Ctrl-C has
 * decided they want their terminal back, and pretending not to hear it is worse.
 *
 * Bounded on purpose. "Wait for the work" without a limit is how a container sits there until
 * Docker's grace period runs out and SIGKILLs it, which is the outcome this exists to avoid.
 * The budget is `WORKER_SHUTDOWN_TIMEOUT_MS` and it must stay under the compose
 * `stop_grace_period`.
 */
export interface ShutdownOptions {
  tasks: BackgroundTasks
  /** Stop producing: clear the timers, flush anything queued up. Failures are logged only. */
  stopProducers: () => Promise<void> | void
  /** Waits for in-flight job handlers on its own; bounded here as well. */
  closeQueue: () => Promise<void>
  closeDb: () => Promise<void>
  timeoutMs: number
  exit: (code: number) => void
  now?: () => number
}

export const createShutdown = (opts: ShutdownOptions): ((signal: string) => Promise<void>) => {
  const now = opts.now ?? Date.now
  let shuttingDown = false

  return async (signal: string) => {
    if (shuttingDown) {
      log.warn(`${signal} again — exiting without waiting for in-flight work`)
      opts.exit(1)
      return
    }
    shuttingDown = true
    const deadline = now() + opts.timeoutMs
    try {
      await opts.stopProducers()
    } catch (err) {
      log.error('stopping producers failed', err)
    }
    log.info('shutting down', { signal, inflight: opts.tasks.size, timeoutMs: opts.timeoutMs })

    const drained = await opts.tasks.drain(opts.timeoutMs)
    if (!drained)
      log.warn('background work still running after the shutdown timeout; closing anyway', {
        inflight: opts.tasks.size,
      })

    // A Redis that has stopped answering must not hold the container open until SIGKILL, so
    // the queue gets whatever is left of the budget (a second, at least, to say goodbye).
    const closed = await Promise.race([
      opts.closeQueue().then(() => true),
      new Promise<false>((resolve) => {
        const t = setTimeout(() => resolve(false), Math.max(1_000, deadline - now()))
        t.unref?.()
      }),
    ]).catch((err) => {
      log.error('queue close failed', err)
      return false
    })
    if (!closed) log.warn('queue did not close in time')

    await opts.closeDb().catch((err) => log.error('database close failed', err))
    log.info('stopped', { signal, drained, closed })
    // Non-zero only when work was abandoned, so `docker ps -a` distinguishes a clean deploy
    // from one that cut a chapter in half.
    opts.exit(drained && closed ? 0 : 1)
  }
}
