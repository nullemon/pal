import { entitlementOverridesSchema, parseEntitlementOverrides } from '@palscans/core'
import { getDb, getSetting, settings } from '@palscans/db'
import { audit } from '@/components/admin/server/audit'
import { purgeSettings } from '@/components/admin/server/cache'
import { ok, parseJson, withPermission } from '@/lib/auth'
import { ENTITLEMENTS_SETTING_KEY } from '@/lib/entitlements'

/**
 * PUT /api/admin/entitlements — `settings.entitlements` (docs/17 §B): the per-feature mode,
 * the "all premium features free" master switch and its window. Saving purges the settings
 * cache, so every gate reads the new value on the next request without a deploy.
 */
export const PUT = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, entitlementOverridesSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const before = parseEntitlementOverrides(
    await getSetting<unknown>(db, ENTITLEMENTS_SETTING_KEY, null),
  )
  const value = parsed.data
  const now = new Date()
  await db
    .insert(settings)
    .values({ key: ENTITLEMENTS_SETTING_KEY, value, updatedBy: user.id, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedBy: user.id, updatedAt: now },
    })
  purgeSettings()
  await audit({
    actorId: user.id,
    action: 'settings.entitlements',
    targetType: 'settings',
    before,
    after: value,
    request,
  })
  return ok(value)
})
