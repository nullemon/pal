import { getDb } from '@palscans/db'
import { revalidatePath } from 'next/cache'
import { audit } from '@/components/admin/server/audit'
import { purgeSettings } from '@/components/admin/server/cache'
import { ok, parseJson, withPermission } from '@/lib/auth'
import {
  notificationSettingsSchema,
  readNotificationSettings,
  writeNotificationSettings,
} from '@/lib/notifications'

/**
 * PUT /api/admin/notifications — the `settings.notifications` document (docs/17 §D).
 *
 * Credentials (VAPID, the bot token) are never written here: they live in the environment, so
 * what this stores is only the operator's *intent* — which channels are on, which webhooks
 * exist, when the digest goes out and which Discord role each plan earns.
 */
export const PUT = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, notificationSettingsSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const before = await readNotificationSettings(db)
  await writeNotificationSettings(db, parsed.data, user.id)
  purgeSettings()
  revalidatePath('/me/notifications')
  await audit({
    actorId: user.id,
    action: 'settings.notifications',
    targetType: 'settings',
    // Webhook URLs are credentials; the audit row keeps the shape, never the secret.
    before: redact(before),
    after: redact(parsed.data),
  })
  return ok(parsed.data)
})

type Settings = ReturnType<typeof notificationSettingsSchema.parse>

const redact = (s: Settings) => ({
  ...s,
  discord: {
    ...s.discord,
    webhooks: s.discord.webhooks.map((w) => ({
      id: w.id,
      name: w.name,
      events: w.events,
      enabled: w.enabled,
    })),
  },
})
