import { WATERMARK_SETTING_KEY } from '@palscans/core/watermark'
import { getDb, getSetting, settings } from '@palscans/db'
import { watermarkSettingSchema } from '@/components/admin/schemas-appearance'
import { audit } from '@/components/admin/server/audit'
import { purgeSettings } from '@/components/admin/server/cache'
import { ok, parseJson, withPermission } from '@/lib/auth'

/**
 * PUT /api/admin/appearance/watermark — docs/04 Appearance → Watermark.
 *
 * Writes `settings.watermark`, which `chapter.process` reads once per run. It changes
 * nothing that is already published: page objects are content-addressed and immutable, so
 * the new mark reaches a chapter only when that chapter is processed again (Chapters →
 * Re-process pages). Audited like every other settings write.
 */
export const PUT = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, watermarkSettingSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const before = await getSetting<unknown>(db, WATERMARK_SETTING_KEY, null)
  const value = parsed.data
  const now = new Date()
  await db
    .insert(settings)
    .values({ key: WATERMARK_SETTING_KEY, value, updatedBy: user.id, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedBy: user.id, updatedAt: now },
    })
  purgeSettings()
  await audit({
    actorId: user.id,
    action: 'settings.watermark',
    targetType: 'settings',
    before,
    after: value,
    request,
  })
  return ok(value)
})
