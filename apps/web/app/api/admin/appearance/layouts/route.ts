import { getDb, getSetting, settings } from '@palscans/db'
import { layoutsSettingSchema } from '@/components/admin/schemas-appearance'
import { audit } from '@/components/admin/server/audit'
import { purgeSettings } from '@/components/admin/server/cache'
import { ok, parseJson, withPermission } from '@/lib/auth'

/**
 * PUT /api/admin/appearance/layouts — docs/04 Appearance → Layouts: writes
 * `settings.layouts` ({ home, series, reader }) and `settings.ads.reader`, purges the page
 * cache (`revalidateTag('settings')`) and records an audit row.
 */
export const PUT = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, layoutsSettingSchema)
  if (!parsed.ok) return parsed.response
  const { ads, ...layouts } = parsed.data
  const db = await getDb()
  const [beforeLayouts, beforeAds] = await Promise.all([
    getSetting<Record<string, unknown>>(db, 'layouts', {}),
    getSetting<Record<string, unknown>>(db, 'ads', {}),
  ])
  const now = new Date()
  const nextAds = { ...beforeAds, reader: ads }
  for (const [key, value] of [
    ['layouts', layouts],
    ['ads', nextAds],
  ] as const) {
    await db
      .insert(settings)
      .values({ key, value, updatedBy: user.id, updatedAt: now })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedBy: user.id, updatedAt: now },
      })
  }
  purgeSettings()
  await audit({
    actorId: user.id,
    action: 'settings.layouts',
    targetType: 'settings',
    before: { layouts: beforeLayouts, ads: (beforeAds as { reader?: unknown }).reader ?? null },
    after: { layouts, ads: ads },
    request,
  })
  return ok(parsed.data)
})
