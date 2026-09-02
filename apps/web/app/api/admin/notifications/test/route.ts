import { messages } from '@palscans/core/messages'
import { getDb, users } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/components/admin/server/audit'
import { fail, getRateLimiter, ok, parseJson, rateLimited, withPermission } from '@/lib/auth'
import { postWebhook, testMessage } from '@/lib/discord'
import { getMailer } from '@/lib/email'
import { getEnv, pushStatus } from '@/lib/env'
import {
  previewDigest,
  readNotificationSettings,
  recordDelivery,
  sendPush,
} from '@/lib/notifications'

/**
 * POST /api/admin/notifications/test — the send-test control (docs/17 §D).
 *
 * Every test is aimed at the operator themselves (their devices, their inbox) or at a channel
 * they configured, never at readers, so it cannot be used to spam. Each attempt is written to
 * the delivery ledger and to `audit_log` like any other admin action.
 */
const bodySchema = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('push') }),
  z.object({ channel: z.literal('email') }),
  z.object({ channel: z.literal('discord'), webhookId: z.string().min(1).max(40) }),
])

export const POST = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, bodySchema)
  if (!parsed.ok) return parsed.response
  const limiter = getRateLimiter()
  const hit = await limiter.hit(`notify-test:${user.id}`, 10, 300)
  if (!hit.ok) return rateLimited(hit.retryAfterSec)
  const db = await getDb()
  const settings = await readNotificationSettings(db)
  const env = getEnv()
  const site = { siteUrl: env.SITE_URL, siteName: env.SITE_NAME, cdnUrl: env.PUBLIC_CDN_URL }

  if (parsed.data.channel === 'push') {
    const status = pushStatus()
    if (!status.configured)
      return fail(
        503,
        'push_not_configured',
        messages.notify.notConfiguredHint.replace('{keys}', status.missing.join(', ')),
      )
    const res = await sendPush(
      db,
      [user.id],
      {
        title: messages.notify.push.testTitle,
        body: messages.notify.push.testBody,
        url: '/admin/notifications',
        tag: 'test',
        kind: 'test',
      },
      { kind: 'test', ttlSeconds: settings.push.ttlSeconds },
    )
    await audit({
      actorId: user.id,
      action: 'notifications.test',
      targetType: 'settings',
      after: { channel: 'push', sent: res.sent },
      request,
    })
    return ok({ ...res, message: messages.notify.push.testSent.replace('{n}', String(res.sent)) })
  }

  if (parsed.data.channel === 'email') {
    const [row] = await db
      .select({ email: users.email, displayName: users.displayName, username: users.username })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1)
    if (!row) return fail(404, 'not_found')
    const { rendered, digest } = await previewDigest(db, user.id, {
      settings,
      site,
      displayName: row.displayName ?? row.username ?? messages.notify.digest.reader,
    })
    const mailer = getMailer()
    const sent = await mailer.send({
      to: row.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    })
    await recordDelivery(db, {
      userId: user.id,
      kind: 'test',
      channel: 'email',
      status: sent.ok ? 'sent' : 'failed',
      target: row.email.split('@')[1] ?? null,
      detail: sent.error ?? `${digest.totalChapters} chapters`,
    })
    await audit({
      actorId: user.id,
      action: 'notifications.test',
      targetType: 'settings',
      after: { channel: 'email', ok: sent.ok },
      request,
    })
    if (!sent.ok)
      return fail(
        503,
        'mail_unavailable',
        messages.notify.admin.testFailed.replace('{error}', sent.error ?? 'mail'),
      )
    return ok({ message: messages.notify.digest.testSent })
  }

  const body = parsed.data
  if (body.channel !== 'discord') return fail(400, 'bad_request')
  const hook = settings.discord.webhooks.find((w) => w.id === body.webhookId)
  if (!hook) return fail(404, 'not_found')
  const res = await postWebhook(hook.url, testMessage(site.siteName, site.siteUrl))
  await recordDelivery(db, {
    kind: 'test',
    channel: 'discord',
    status: res.ok ? 'sent' : 'failed',
    target: hook.name,
    detail: res.error ?? null,
  })
  await audit({
    actorId: user.id,
    action: 'notifications.test',
    targetType: 'settings',
    after: { channel: 'discord', webhook: hook.name, ok: res.ok },
    request,
  })
  if (!res.ok)
    return fail(
      502,
      'discord_failed',
      messages.notify.admin.testFailed.replace('{error}', res.error ?? 'discord'),
    )
  return ok({ message: messages.notify.admin.testSent.replace('{name}', hook.name) })
})
