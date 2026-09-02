import { getDb, getSetting, settings } from '@palscans/db'
import { revalidatePath } from 'next/cache'
import { adsSettingSchema } from '@/components/admin/schemas-system'
import { audit } from '@/components/admin/server/audit'
import { purgeSettings } from '@/components/admin/server/cache'
import { ok, parseJson, withPermission } from '@/lib/auth'

/** PUT /api/admin/ads — per-slot switches + tags (`settings.ads.slots`) and the ads.txt body. */
export const PUT = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, adsSettingSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const before = await getSetting<Record<string, unknown>>(db, 'ads', {})
  const now = new Date()
  const value = { ...before, slots: parsed.data.slots, ads_txt: parsed.data.ads_txt }
  await db
    .insert(settings)
    .values({ key: 'ads', value, updatedBy: user.id, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedBy: user.id, updatedAt: now },
    })
  purgeSettings()
  revalidatePath('/ads.txt')
  await audit({
    actorId: user.id,
    action: 'settings.ads',
    targetType: 'settings',
    before: { slots: before.slots ?? null, ads_txt: before.ads_txt ?? null },
    after: { slots: parsed.data.slots, ads_txt: parsed.data.ads_txt },
    request,
  })
  return ok(parsed.data)
})
