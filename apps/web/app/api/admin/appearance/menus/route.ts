import { getDb, getSetting, settings } from '@palscans/db'
import { audit } from '@/components/admin/server/audit'
import { purgeSettings } from '@/components/admin/server/cache'
import { ok, parseJson, withPermission } from '@/lib/auth'
import { menusSettingSchema } from '@/lib/chrome/schema'

/**
 * `PUT /api/admin/appearance/menus` — Appearance → Header, footer, menus (docs/15): the
 * header links and primary button, the footer columns, the community block, the copyright and
 * attribution lines, the mobile bottom nav and the announcement bar.
 *
 * The whole document is replaced rather than merged: the screen edits every field it stores,
 * and a merge would make "remove the last footer column" impossible to express. Unknown keys
 * on the stored row are dropped, which is how the seeded shape from before this screen
 * existed gets normalised on the first save.
 */
export const PUT = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, menusSettingSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const before = await getSetting<Record<string, unknown>>(db, 'menus', {})
  const value = parsed.data
  const now = new Date()
  await db
    .insert(settings)
    .values({ key: 'menus', value, updatedBy: user.id, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedBy: user.id, updatedAt: now },
    })
  purgeSettings()
  await audit({
    actorId: user.id,
    action: 'settings.menus',
    targetType: 'settings',
    before,
    after: value,
    request,
  })
  return ok(value)
})
