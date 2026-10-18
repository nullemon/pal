import { canReadChapter } from '@palscans/core/access'
import { chapters, getDb } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { creditForChapter } from '@/components/admin/server/credit'
import { getSessionUser } from '@/lib/auth/session'
import { renderCreditPage } from '@/lib/credit/render'
import { entitlementGate } from '@/lib/entitlements'
import { getStorage } from '@/lib/storage'

/**
 * GET /credit/:chapter — this chapter's credit card, composed on the fly (docs/03).
 *
 * Rendered rather than stored, which is the point: the note is per chapter, so storing them
 * would be one image per chapter forever, on a site whose chapters mostly store nothing at
 * all. Composing costs one render per chapter in practice, because the answer is immutable
 * for its inputs and cached hard below.
 *
 * Entitlement applies, like any other page of the chapter. A credit card is not a secret,
 * but it is *inside* a chapter, and a locked chapter that leaks its second page is a locked
 * chapter with a hole in it. The rule is the same one `/p/:chapter/:idx` uses.
 */

const chapterSchema = z.coerce.number().int().positive()

/**
 * A week at the edge, an hour in the browser.
 *
 * Not `immutable`: the card is addressed by chapter, and its contents change when an
 * operator edits the note, the roles or the overlay. Saving the settings purges the
 * catalogue, which is what gives the edge a reason to come back for it.
 */
const PUBLIC_CACHE = 'public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400'

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ chapter: string }> },
): Promise<Response> {
  const parsed = chapterSchema.safeParse((await ctx.params).chapter)
  if (!parsed.success) return new Response('Not found', { status: 404 })

  const db = await getDb()
  const [row] = await db
    .select({
      id: chapters.id,
      state: chapters.state,
      isPremium: chapters.isPremium,
      earlyAccessUntil: chapters.earlyAccessUntil,
    })
    .from(chapters)
    .where(and(eq(chapters.id, parsed.data), isNull(chapters.deletedAt)))
    .limit(1)
  if (!row) return new Response('Not found', { status: 404 })

  const user = await getSessionUser()
  const gate = await entitlementGate()
  const now = new Date()
  const allowed = canReadChapter(
    user,
    {
      state: row.state,
      is_premium: row.isPremium,
      early_access_until: row.earlyAccessUntil ? new Date(row.earlyAccessUntil) : null,
    },
    { overrides: gate.overrides, now },
  )
  if (!allowed) return new Response('Locked', { status: 403 })

  const credit = await creditForChapter(row.id, db)
  // No credit page is an ordinary answer, not an error: the feature may be off, the series
  // may have no overlay, the settings may be half filled in. The reader just gets a chapter
  // without one.
  if (!credit) return new Response('Not found', { status: 404 })

  const image = await renderCreditPage(credit, await getStorage())
  if (!image) return new Response('Not found', { status: 404 })

  const locked = row.isPremium || (row.earlyAccessUntil && row.earlyAccessUntil > now)
  return new Response(image as BodyInit, {
    headers: {
      'content-type': 'image/jpeg',
      'content-length': String(image.byteLength),
      // A locked chapter's card is never held by a shared cache: the check above is per
      // viewer, and an edge copy would be handed to whoever asked next.
      'cache-control': locked ? 'private, no-store' : PUBLIC_CACHE,
      'x-content-type-options': 'nosniff',
    },
  })
}
