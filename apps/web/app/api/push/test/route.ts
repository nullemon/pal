import { messages } from '@palscans/core/messages'
import { getDb } from '@palscans/db'
import { fail, getRateLimiter, ok, rateLimited, requireUser } from '@/lib/auth'
import { pushStatus } from '@/lib/env'
import { readNotificationSettings, sendPush } from '@/lib/notifications'

/**
 * POST /api/push/test — push a test notification to the caller's *own* devices.
 *
 * Readers use it from `/me/notifications` to prove the subscription works; the admin screen
 * calls the same endpoint. It can only ever reach the caller, so it needs no permission of
 * its own — just a rate limit, because every call wakes a phone.
 */
export const POST = requireUser(async (_request, _ctx, user) => {
  const status = await pushStatus()
  if (!status.configured)
    return fail(
      503,
      'push_not_configured',
      messages.notify.notConfiguredHint.replace('{keys}', status.missing.join(', ')),
    )
  const limiter = getRateLimiter()
  const hit = await limiter.hit(`push-test:${user.id}`, 5, 300)
  if (!hit.ok) return rateLimited(hit.retryAfterSec)
  const db = await getDb()
  const settings = await readNotificationSettings(db)
  const res = await sendPush(
    db,
    [user.id],
    {
      title: messages.notify.push.testTitle,
      body: messages.notify.push.testBody,
      url: '/me/notifications',
      tag: 'test',
      kind: 'test',
    },
    { kind: 'test', ttlSeconds: settings.push.ttlSeconds },
  )
  return ok({
    ...res,
    message: messages.notify.push.testSent.replace('{n}', String(res.sent)),
  })
})
