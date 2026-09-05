import { getDb, themePresets } from '@palscans/db'
import { presetSchema } from '@/components/admin/schemas-appearance'
import { audit } from '@/components/admin/server/audit'
import { carryAdvanced, EMPTY_ADVANCED, parseAppearance } from '@/lib/appearance/schema'
import { ok, parseJson, withPermission } from '@/lib/auth'

/**
 * POST /api/admin/appearance/theme/presets { name, settings } — save the current look as a
 * preset.
 *
 * The advanced block is stripped, not carried. docs/15 exports and imports presets as JSON,
 * so a preset is a file that travels: if it could carry `head_html`, "import this nice
 * violet theme somebody posted" would be a one-click script injection, from a
 * `settings.write` screen, past the admin-only gate on `appearance.advanced`.
 */
export const POST = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, presetSchema)
  if (!parsed.ok) return parsed.response
  const doc = carryAdvanced(parseAppearance(parsed.data.settings), EMPTY_ADVANCED)
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
