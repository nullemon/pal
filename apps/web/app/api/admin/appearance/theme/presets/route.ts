import { getDb, themePresets } from '@palscans/db'
import { presetSchema } from '@/components/admin/schemas-appearance'
import { audit } from '@/components/admin/server/audit'
import { parseAppearance } from '@/lib/appearance/schema'
import { ok, parseJson, withPermission } from '@/lib/auth'

/** POST /api/admin/appearance/theme/presets { name, settings } — save the current look as a preset. */
export const POST = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, presetSchema)
  if (!parsed.ok) return parsed.response
  const doc = parseAppearance(parsed.data.settings)
  const db = await getDb()
  const [row] = await db
    .insert(themePresets)
    .values({ name: parsed.data.name, settings: doc, createdBy: user.id })
    .returning({ id: themePresets.id, name: themePresets.name })
  await audit({
    actorId: user.id,
    action: 'appearance.preset',
    targetType: 'theme_preset',
    targetId: row?.id ?? null,
    after: { name: parsed.data.name },
    request,
  })
  return ok({ ...row, doc })
})
