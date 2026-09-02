import { getDb, getSetting, settings } from '@palscans/db'
import { revalidatePath } from 'next/cache'
import { billingSettingsInput } from '@/components/admin/premium/billing-schemas'
import { audit } from '@/components/admin/server/audit'
import { purgeSettings } from '@/components/admin/server/cache'
import { ok, parseJson, withPermission } from '@/lib/auth'
import { BILLING_SETTINGS_KEY } from '@/lib/billing/settings'

/**
 * `PUT /api/admin/premium/billing` — the billing half of Admin → Business → Premium
 * (docs/17 §A). Grace window, Stripe Tax, the portal switch and the statement descriptor live
 * in `settings.billing`, exactly like `ads` and `layouts`.
 */
export const PUT = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, billingSettingsInput)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const before = await getSetting<Record<string, unknown>>(db, BILLING_SETTINGS_KEY, {})
  const now = new Date()
  const value = { ...before, ...parsed.data }
  await db
    .insert(settings)
    .values({ key: BILLING_SETTINGS_KEY, value, updatedBy: user.id, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedBy: user.id, updatedAt: now },
    })
  purgeSettings()
  revalidatePath('/subscribe')
  revalidatePath('/me/billing')
  await audit({
    actorId: user.id,
    action: 'settings.billing',
    targetType: 'settings',
    before,
    after: value,
    request,
  })
  return ok(parsed.data)
})
