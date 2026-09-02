import { messages } from '@palscans/core/messages'
import { getDb } from '@palscans/db'
import { fail, ok, parseJson, requireUser } from '@/lib/auth'
import { pushStatus } from '@/lib/env'
import { deleteSubscription, saveSubscription } from '@/lib/notifications'
import { pushSubscriptionSchema, pushUnsubscribeSchema } from '../schemas'

/**
 * POST /api/push/subscribe — store the `PushSubscription` the browser just handed the page.
 * DELETE — drop it again (the reader turned push off, or the browser rotated the endpoint).
 *
 * Rows are keyed by endpoint, so re-subscribing on the same device updates in place and a
 * shared device that changes accounts moves the row rather than duplicating it. With VAPID
 * unset both answer 503: the browser could not have produced a usable subscription anyway.
 */
const notConfigured = () =>
  fail(
    503,
    'push_not_configured',
    messages.notify.notConfiguredHint.replace('{keys}', pushStatus().missing.join(', ')),
  )

export const POST = requireUser(async (request, _ctx, user) => {
  if (!pushStatus().configured) return notConfigured()
  const parsed = await parseJson(request, pushSubscriptionSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  await saveSubscription(db, {
    userId: user.id,
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    userAgent: request.headers.get('user-agent'),
  })
  return ok({ subscribed: true, message: messages.notify.push.subscribed })
})

export const DELETE = requireUser(async (request, _ctx, user) => {
  const parsed = await parseJson(request, pushUnsubscribeSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const removed = await deleteSubscription(db, user.id, parsed.data.endpoint)
  return ok({ removed, message: messages.notify.push.unsubscribed })
})
