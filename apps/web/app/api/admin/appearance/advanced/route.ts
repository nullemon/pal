import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { appearanceSettings, getDb } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { advancedFormSchema } from '@/components/admin/schemas-appearance'
import { audit } from '@/components/admin/server/audit'
import { purgeAppearance } from '@/components/admin/server/cache'
import { CSS_MAX_LENGTH, reviewAdvanced, SNIPPET_MAX_LENGTH } from '@/lib/appearance/advanced'
import { resolveAppearance } from '@/lib/appearance/resolve'
import {
  type AdvancedDoc,
  carryAdvanced,
  DEFAULT_APPEARANCE,
  parseAppearance,
} from '@/lib/appearance/schema'
import { fail, ok, parseJson, withPermission } from '@/lib/auth'

/**
 * `PUT /api/admin/appearance/advanced` — docs/15 "Advanced".
 *
 * **`appearance.advanced`, not `settings.write`.** docs/15 calls the head/footer boxes
 * admin-only and this route holds the custom CSS box to the same bar, because CSS is not
 * harmless either: it can cover the viewport with a transparent layer that swallows clicks,
 * restyle the sign-in form into something it is not, and pull the reader's IP address out to
 * a third party through `url()`. Both boxes are the same power, so both get the same door.
 * `ADMIN_ONLY_PERMISSIONS` in `@palscans/core` stops `Admin → Access → Roles` — itself a
 * `settings.write` screen — from granting that door to anybody else, and `withPermission`
 * additionally refuses an `admin` who has not enrolled TOTP (docs/07).
 *
 * **A save is live.** The Theme screen's draft → preview → publish flow is right for a look
 * and wrong for this: nobody can look at a page and see whether the analytics tag is
 * recording, and a snippet sitting in an unpublished draft is how an operator ends up
 * pasting it a second time. So this writes a new *published* appearance version, archiving
 * the previous one — the change still lands in the version list and in `audit_log`, it just
 * does not wait. The way back from a bad save is the `enabled` switch, which is one field on
 * this same route.
 *
 * It also writes the block into the open draft, if there is one. Otherwise a colleague
 * publishing an unrelated Theme draft an hour later would silently revert the custom code.
 */
export const PUT = withPermission('appearance.advanced', async (request, _ctx, user) => {
  const parsed = await parseJson(request, advancedFormSchema)
  if (!parsed.ok) return parsed.response
  const next: AdvancedDoc = parsed.data
  const m = adminMessages.advancedScreen

  // The same verdict the screen shows as you type, taken again here: the screen is a
  // convenience, this is the rule. A refused document is never written, so it can never be
  // rendered — a stylesheet with an unbalanced brace swallows every rule after it.
  const review = reviewAdvanced(next)
  const refusal = review.refusal
  if (refusal) {
    const { problem } = refusal
    const text =
      refusal.kind === 'css'
        ? fmt(m.css[problem.code as keyof typeof m.css], {
            line: problem.line,
            detail: problem.detail ?? '',
            max: CSS_MAX_LENGTH,
          })
        : fmt(m.html[problem.code as keyof typeof m.html], {
            line: problem.line,
            detail: problem.detail ?? '',
            max: SNIPPET_MAX_LENGTH,
          })
    return fail(422, refusal.kind === 'css' ? 'invalid_css' : 'invalid_html', text)
  }

  const db = await getDb()
  const now = new Date()
  const [current] = await db
    .select({ id: appearanceSettings.id, settings: appearanceSettings.settings })
    .from(appearanceSettings)
    .where(eq(appearanceSettings.status, 'published'))
    .limit(1)
  const [draft] = await db
    .select({ id: appearanceSettings.id, settings: appearanceSettings.settings })
    .from(appearanceSettings)
    .where(eq(appearanceSettings.status, 'draft'))
    .limit(1)

  const base = current ? parseAppearance(current.settings) : DEFAULT_APPEARANCE
  const before = base.advanced
  const doc = carryAdvanced(base, next)
  let publishedId = 0

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
    if (draft) {
      const draftDoc = carryAdvanced(parseAppearance(draft.settings), next)
      await tx
        .update(appearanceSettings)
        .set({ settings: draftDoc })
        .where(eq(appearanceSettings.id, draft.id))
    }
  })

  purgeAppearance()

  // docs/15 "changes audited". The whole text goes in, both sides: this is the record an
  // operator reads back to recover the stylesheet they overwrote, so a summary is no use.
  await audit({
    actorId: user.id,
    action: 'appearance.advanced',
    targetType: 'appearance',
    targetId: publishedId,
    before,
    after: next,
    request,
  })

  return ok({
    id: publishedId,
    advanced: next,
    warnings: {
      css: review.css.warnings,
      head_html: review.head_html.warnings,
      footer_html: review.footer_html.warnings,
    },
    hosts: review.hosts,
  })
})
