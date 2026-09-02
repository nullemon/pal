import type { Queue } from '@palscans/core/queue'
import type { Db } from '@palscans/db'
import { readNotificationSettings } from '../../../web/lib/notifications/index.js'
import { log } from '../lib/log.js'
import { notifyOneChapter, sweepNewChapters } from './notify-chapter.js'
import { runDigestPass } from './notify-digest.js'
import { runRoleSyncPass } from './notify-discord.js'
import { workerSite } from './notify-site.js'

/**
 * D · Notifications, wired into the worker (docs/17 §D).
 *
 * One entry point so `src/index.ts` gains two lines: it takes over the `notify.new_chapter`
 * job and runs three passes on a timer — the new-chapter sweep (push + Discord), the email
 * digest, and the Discord role sync. Each pass reads `settings.notifications` fresh, so an
 * operator turning a channel off takes effect on the next tick without a restart.
 *
 * Every pass is a no-op when its channel is unconfigured, and no pass ever throws into the
 * timer: a channel that is down must not stop the other two.
 */
export interface NotificationsRuntime {
  /** Run every pass once (also exported so a job can force one). */
  tick(): Promise<void>
  stop(): void
}

export const NOTIFY_TICK_MS = 60_000
/** The role sync is slower and far less urgent than a chapter going up. */
export const ROLE_SYNC_EVERY = 15

export const registerNotifications = (
  db: Db,
  queue: Queue,
  opts: { tickMs?: number } = {},
): NotificationsRuntime => {
  const site = workerSite()
  let ticks = 0
  let running = false

  const tick = async () => {
    if (running) return
    running = true
    try {
      const settings = await readNotificationSettings(db)
      await sweepNewChapters(db, { settings, site })
      await runDigestPass(db, { settings, site })
      if (ticks % ROLE_SYNC_EVERY === 0) await runRoleSyncPass(db, settings)
    } catch (err) {
      log.error('notifications tick failed', err)
    } finally {
      ticks += 1
      running = false
    }
  }

  queue.process('notify.new_chapter', async (job) => {
    const chapterId = Number((job.data as { chapterId?: unknown }).chapterId)
    if (!Number.isFinite(chapterId)) return
    try {
      const settings = await readNotificationSettings(db)
      const summary = await notifyOneChapter(db, chapterId, { settings, site })
      log.info('notify.new_chapter', summary)
    } catch (err) {
      log.error(`notify.new_chapter ${chapterId} failed`, err)
    }
  })

  const timer = setInterval(() => void tick(), opts.tickMs ?? NOTIFY_TICK_MS)
  void tick()
  return {
    tick,
    stop: () => clearInterval(timer),
  }
}
