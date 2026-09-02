import { appearanceSettings, getDb } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { themeDraftSchema } from '@/components/admin/schemas-appearance'
import { audit } from '@/components/admin/server/audit'
import { resolveAppearance } from '@/lib/appearance/resolve'
import { parseAppearance } from '@/lib/appearance/schema'
import { ok, parseJson, withPermission } from '@/lib/auth'

/** PUT /api/admin/appearance/theme — save the draft (one draft row at a time, docs/15 "Preview"). */
export const PUT = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, themeDraftSchema)
  if (!parsed.ok) return parsed.response
  const doc = parseAppearance(parsed.data.settings)
  const resolved = resolveAppearance(doc)
  const db = await getDb()
  const [existing] = await db
    .select({ id: appearanceSettings.id })
    .from(appearanceSettings)
    .where(eq(appearanceSettings.status, 'draft'))
    .limit(1)
  let id: number
  if (existing) {
    await db
      .update(appearanceSettings)
      .set({ settings: doc, resolvedCss: resolved.css, createdBy: user.id, createdAt: new Date() })
      .where(eq(appearanceSettings.id, existing.id))
    id = existing.id
  } else {
    const [row] = await db
      .insert(appearanceSettings)
      .values({ settings: doc, resolvedCss: resolved.css, status: 'draft', createdBy: user.id })
      .returning({ id: appearanceSettings.id })
    id = row?.id ?? 0
  }
  await audit({
    actorId: user.id,
    action: 'appearance.draft',
    targetType: 'appearance',
    targetId: id,
    after: { accent: doc.color.accent, theme: doc.theme.default },
    request,
  })
  return ok({ id, contrast: resolved.contrast, ramp: resolved.ramp })
})
