import { log } from './log.js'

/**
 * Keep one lost promise from taking the worker down.
 *
 * Node 22 defaults to `--unhandled-rejections=throw`: a rejected promise with no handler is
 * re-thrown as an uncaught exception and the process exits, non-zero, immediately. Verified
 * by execution rather than assumed. This process is full of promises that are deliberately
 * not awaited — the tick starts chapter, art and re-apply runs it does not wait for, and
 * `chapter-process` persists its progress document every 750 ms for the whole length of an
 * encode. That last one is the sharp edge: a plain `db.update` on a timer, so a Postgres
 * restart during a deploy, or `too many clients` under load, killed the worker *mid-chapter*.
 * The chapter stayed `processing` until the 30-minute stale sweep, and the worker crash-looped
 * for as long as Postgres was unhappy — one transient error, minutes of dead pipeline.
 *
 * So: log it and carry on. The call sites still attach their own `.catch` (see
 * `lib/background.ts`); this is the net under them, for the ones nobody thought of.
 *
 * `uncaughtException` is deliberately **not** installed. A synchronous throw that reached the
 * top of the stack left the process in a state nothing here can reason about, and swallowing
 * it would turn a restart into a silent half-running worker. Docker's `restart: unless-stopped`
 * is the right answer to that one; a rejected promise is not that.
 */
export const installCrashGuards = (target: NodeJS.EventEmitter = process): (() => void) => {
  const onRejection = (reason: unknown) => {
    log.error('unhandled rejection (worker kept running)', reason)
    if (reason instanceof Error && reason.stack) console.error(reason.stack)
  }
  target.on('unhandledRejection', onRejection)
  return () => {
    target.off('unhandledRejection', onRejection)
  }
}
