import { appearanceSettings, getDb } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { themePublishSchema } from '@/components/admin/schemas-appearance'
import { audit } from '@/components/admin/server/audit'
import { purgeAppearance } from '@/components/admin/server/cache'
import { resolveAppearance } from '@/lib/appearance/resolve'
import { carryAdvanced, parseAppearance } from '@/lib/appearance/schema'
import { fail, ok, parseJson, withPermission } from '@/lib/auth'

/**
 * POST /api/admin/appearance/theme/publish { versionId? } — publish the draft, or revert to
 * an earlier version (a copy of it becomes the new published row so history stays linear).
 * Archives the previous published row, purges the `appearance` cache tag, audits.
 *
 * **A revert carries the live `advanced` block forward rather than restoring the old one.**
 * This route is `settings.write`; the custom code is `appearance.advanced` (admin-only,
 * docs/15). Restoring a six-month-old version would otherwise let a `settings.write` holder
 * put back a tracking script an administrator had deliberately removed — admin-authored
 * text, but somebody else's decision to run it. Custom code changes on its own screen, which
 * is also where its own history is. Publishing the *draft* does carry the draft's block,
 * because only `PUT /api/admin/appearance/advanced` can have put it there.
 */
export const POST = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, themePublishSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const now = new Date()
  const [current] = await db
    .select({ id: appearanceSettings.id, settings: appearanceSettings.settings })
    .from(appearanceSettings)
    .where(eq(appearanceSettings.status, 'published'))
    .limit(1)
  let publishedId = 0
  if (parsed.data.versionId) {
    const [version] = await db
      .select({ settings: appearanceSettings.settings })
      .from(appearanceSettings)
      .where(eq(appearanceSettings.id, parsed.data.versionId))
      .limit(1)
    if (!version) return fail(404, 'not_found')
    const doc = carryAdvanced(
      parseAppearance(version.settings),
      parseAppearance(current?.settings ?? {}).advanced,
    )
    await db.transaction(async (tx) => {
      if (current)
        await tx
          .update(appearanceSettings)
          .set({ status: 'archived' })
          .where(eq(appearanceSettings.id, current.id))
      const [row] = await tx
        .insert(appearanceSettings)
        .values({
          settings: doc,
          resolvedCss: resolveAppearance(doc).css,
          status: 'published',
          publishedAt: now,
          createdBy: user.id,
        })
        .returning({ id: appearanceSettings.id })
      publishedId = row?.id ?? 0
    })
  } else {
    const [draft] = await db
      .select({ id: appearanceSettings.id, settings: appearanceSettings.settings })
      .from(appearanceSettings)
      .where(eq(appearanceSettings.status, 'draft'))
      .limit(1)
    if (!draft) return fail(400, 'no_draft')
    const doc = parseAppearance(draft.settings)
    await db.transaction(async (tx) => {
      if (current)
        await tx
          .update(appearanceSettings)
          .set({ status: 'archived' })
          .where(eq(appearanceSettings.id, current.id))
      await tx
        .update(appearanceSettings)
        .set({
          status: 'published',
          publishedAt: now,
          resolvedCss: resolveAppearance(doc).css,
          settings: doc,
        })
        .where(eq(appearanceSettings.id, draft.id))
    })
    publishedId = draft.id
  }
  purgeAppearance()
  await audit({
    actorId: user.id,
    action: parsed.data.versionId ? 'appearance.revert' : 'appearance.publish',
    targetType: 'appearance',
    targetId: publishedId,
    before: current
      ? {
          id: current.id,
          accent: (current.settings as { color?: { accent?: string } }).color?.accent,
        }
      : null,
    after: { id: publishedId, from: parsed.data.versionId ?? null },
    request,
  })
  return ok({ id: publishedId })
})
