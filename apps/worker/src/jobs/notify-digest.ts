import type { Db } from '@palscans/db'
import {
  type DigestRunSummary,
  mailerFromEnv,
  type NotificationSettings,
  runDigests,
} from '../../../web/lib/notifications/index.js'
import { log } from '../lib/log.js'
import type { WorkerSite } from './notify-site.js'

/**
 * The email digest pass (docs/17 §D). Runs on the worker's tick and mails only the readers
 * whose slot has come round — the scheduling lives in `isDigestDue`, so a worker restart or a
 * missed tick catches up instead of skipping a day.
 *
 * The mailer is the console locally and Resend when `RESEND_API_KEY` is set, matching the web
 * app; nothing here reaches the network otherwise.
 */
export interface DigestPassDeps {
  settings: NotificationSettings
  site: WorkerSite
  now?: Date
  limit?: number
}

export const runDigestPass = async (
  db: Db,
  deps: DigestPassDeps,
): Promise<DigestRunSummary> => {
  const summary = await runDigests(db, {
    settings: deps.settings,
    site: { siteUrl: deps.site.siteUrl, siteName: deps.site.siteName, cdnUrl: deps.site.cdnUrl },
    mailer: mailerFromEnv(),
    now: deps.now,
    limit: deps.limit,
  })
  if (summary.considered > 0) log.info('digest pass', summary)
  return summary
}
