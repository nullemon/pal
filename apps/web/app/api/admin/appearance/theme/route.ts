import { appearanceSettings, getDb } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { themeDraftSchema } from '@/components/admin/schemas-appearance'
import { audit } from '@/components/admin/server/audit'
import { resolveAppearance } from '@/lib/appearance/resolve'
import { carryAdvanced, parseAppearance } from '@/lib/appearance/schema'
import { ok, parseJson, withPermission } from '@/lib/auth'

/**
 * PUT /api/admin/appearance/theme — save the draft (one draft row at a time, docs/15 "Preview").
 *
 * The posted document's `advanced` block is discarded and the stored one carried forward.
 * This route is `settings.write`; the custom CSS and the head/footer snippets are
 * `appearance.advanced` (admin-only, docs/15). Without this line, anyone who can save a
 * theme could POST an `advanced.head_html` of their own and put a `<script>` on every public
 * page — the permission would be decoration. `advanced.test.ts` asserts it.
 */
export const PUT = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, themeDraftSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const [existing] = await db
    .select({ id: appearanceSettings.id, settings: appearanceSettings.settings })
    .from(appearanceSettings)
    .where(eq(appearanceSettings.status, 'draft'))
    .limit(1)
  const [published] = await db
    .select({ settings: appearanceSettings.settings })
    .from(appearanceSettings)
    .where(eq(appearanceSettings.status, 'published'))
    .limit(1)
  const stored = existing ?? published
  const doc = carryAdvanced(
    parseAppearance(parsed.data.settings),
    parseAppearance(stored?.settings ?? {}).advanced,
  )
  const resolved = resolveAppearance(doc)
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
