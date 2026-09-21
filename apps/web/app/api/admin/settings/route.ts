import { getDb, getSetting, settings } from '@palscans/db'
import { siteSettingSchema } from '@/components/admin/schemas-system'
import { audit } from '@/components/admin/server/audit'
import { purgeSettings } from '@/components/admin/server/cache'
import { ok, parseJson, withPermission } from '@/lib/auth'

/** PUT /api/admin/settings — `settings.site`: name, tagline, registration mode, maintenance. */
export const PUT = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, siteSettingSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const before = await getSetting<Record<string, unknown>>(db, 'site', {})
  const value = { ...before, ...parsed.data }
  const now = new Date()
  await db
    .insert(settings)
    .values({ key: 'site', value, updatedBy: user.id, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedBy: user.id, updatedAt: now },
    })
  purgeSettings()
  const pick = (o: Record<string, unknown>) => ({
    name: o.name,
    tagline: o.tagline,
    url: o.url,
    discord_url: o.discord_url,
    registration: o.registration,
    maintenance: o.maintenance,
  })
  await audit({
    actorId: user.id,
    action: 'settings.site',
    targetType: 'settings',
    before: pick(before),
    after: pick(value),
  })
  return ok(parsed.data)
})
