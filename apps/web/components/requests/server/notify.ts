import { fmt, messages } from '@palscans/core/messages'
import { getDb, notifications } from '@palscans/db'
import type { RequestStatusValue } from '../shared'

/**
 * Tell the requester what happened — through the `notifications` table the rest of the site
 * already uses (`/me/notifications` renders `title` / `body` / `href` out of the payload;
 * `kind: 'system'` is the same lane a moderation warning uses). No second notification
 * system, no new channel, no new preference: an outcome on something you asked for is
 * account correspondence, and it lands where the reader already looks.
 *
 * Only ever sent to a signed-in requester, because an anonymous one left no way to reach
 * them. That is the strongest argument the board has for signing in, and the modal says so.
 */
export interface NotifyInput {
  userId: number | null
  status: RequestStatusValue
  title: string
  seriesHref: string | null
  declineReason: string | null
}

const m = messages.requests

export const notifyRequester = async (input: NotifyInput): Promise<boolean> => {
  if (!input.userId) return false
  const notice =
    input.status === 'added'
      ? {
          title: fmt(m.notifyAddedTitle, { title: input.title }),
          body: m.notifyAddedBody,
          href: input.seriesHref,
        }
      : input.status === 'exists'
        ? {
            title: fmt(m.notifyExistsTitle, { title: input.title }),
            body: m.notifyExistsBody,
            href: input.seriesHref,
          }
        : input.status === 'declined'
          ? {
              title: fmt(m.notifyDeclinedTitle, { title: input.title }),
              body: fmt(m.notifyDeclinedBody, { reason: input.declineReason ?? '' }).trim(),
              href: '/requests',
            }
          : null
  if (!notice) return false
  try {
    const db = await getDb()
    await db.insert(notifications).values({
      userId: input.userId,
      kind: 'system',
      payload: { title: notice.title, body: notice.body, href: notice.href ?? '/requests' },
      // One notice per request per outcome: a status set twice does not notify twice.
      groupKey: `series_request:${input.status}`,
    })
    return true
  } catch (error) {
    // Never fail the triage action because the notice could not be written.
    console.error('[requests] could not notify the requester', error)
    return false
  }
}
