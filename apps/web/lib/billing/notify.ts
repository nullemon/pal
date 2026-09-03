import { messages } from '@palscans/core/messages'
import { getMailer } from '../email'
import { getEnv } from '../env'
import type { BillingNotice } from './reducer'

/**
 * The four billing emails (docs/07: "keep entitlements alive for 3 days and email", "email a
 * receipt with a one-click cancel link"). Sending is best-effort: a webhook must never fail
 * because the mail provider is down — the rows are already written when this runs.
 */

export interface BillingNoticeTarget {
  email: string
  name?: string | null
  expiresAt?: Date | null
}

const m = messages.billing.email

const bodyFor = (
  notice: BillingNotice,
  target: BillingNoticeTarget,
): { subject: string; text: string } => {
  const billingUrl = `${getEnv().SITE_URL}/me/billing`
  const hello = target.name ? `Hi ${target.name},` : 'Hi,'
  const until = target.expiresAt
    ? `\n\nPerks stay on until ${target.expiresAt.toISOString().slice(0, 10)}.`
    : ''
  switch (notice) {
    case 'payment_failed':
      return {
        subject: m.pastDueSubject,
        text: `${hello}\n\n${m.pastDueIntro}${until}\n\n${m.pastDueCta}: ${billingUrl}`,
      }
    case 'dispute_opened':
      return {
        subject: m.disputeSubject,
        text: `${hello}\n\n${m.disputeIntro}\n\n${m.manageCta}: ${billingUrl}`,
      }
    case 'subscription_started':
      return {
        subject: m.startedSubject,
        text: `${hello}\n\n${m.startedIntro}\n\n${m.manageCta}: ${billingUrl}`,
      }
    case 'subscription_canceled':
      return {
        subject: m.canceledSubject,
        text: `${hello}\n\n${m.canceledIntro}${until}\n\n${m.manageCta}: ${billingUrl}`,
      }
  }
}

export const sendBillingNotice = async (
  notice: BillingNotice,
  target: BillingNoticeTarget,
): Promise<void> => {
  try {
    const { subject, text } = bodyFor(notice, target)
    await (await getMailer()).send({ to: target.email, subject, text })
  } catch (error) {
    console.warn('[billing] notice not sent', notice, error)
  }
}
