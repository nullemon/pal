import type { Db } from '@palscans/db'
import {
  type DigestRunSummary,
  type NotificationSettings,
  resolveMailer,
  runDigests,
} from '../../../web/lib/notifications/index.js'
import { log } from '../lib/log.js'
import type { WorkerSite } from './notify-site.js'

/**
 * The email digest pass (docs/17 §D). Runs on the worker's tick and mails only the readers
 * whose slot has come round — the scheduling lives in `isDigestDue`, so a worker restart or a
 * missed tick catches up instead of skipping a day.
 *
 * The mailer is resolved from the operator's stored settings with the environment behind them
 * (docs/19) — Resend, SMTP, or the console — exactly as the web app resolves it; nothing here
 * reaches the network when neither is set.
 */
export interface DigestPassDeps {
  settings: NotificationSettings
  site: WorkerSite
  now?: Date
  limit?: number
}

export const runDigestPass = async (db: Db, deps: DigestPassDeps): Promise<DigestRunSummary> => {
  const summary = await runDigests(db, {
    settings: deps.settings,
    site: { siteUrl: deps.site.siteUrl, siteName: deps.site.siteName, cdnUrl: deps.site.cdnUrl },
    mailer: await resolveMailer(),
    now: deps.now,
    limit: deps.limit,
  })
  if (summary.considered > 0) log.info('digest pass', summary)
  return summary
}
