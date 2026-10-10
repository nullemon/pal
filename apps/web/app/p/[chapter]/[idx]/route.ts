import { canReadChapter } from '@palscans/core/access'
import { getEnv } from '@palscans/core/env'
import { downloadGalleryImage, GalleryError } from '@palscans/core/gallery'
import { MAX_ORIGINAL_BYTES } from '@palscans/core/storage'
import { chapterPages, chapters, getDb } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getSessionUser } from '@/lib/auth/session'
import { entitlementGate } from '@/lib/entitlements'

/**
 * GET /p/:chapter/:idx — a page that lives on the host it was imported from.
 *
 * The reason this route exists rather than putting the origin URL straight into the reader:
 *
 * 1. **Entitlement survives.** A locked chapter is enforced here, before the fetch. Handing
 *    `cdn.imgchest.com/...` to the browser would make every premium and early-access page
 *    world-readable to anyone who viewed source, which is the whole paywall gone.
 * 2. **The origin is never published.** Readers see our domain; the host does not collect our
 *    traffic, and the gallery is not trivially scrapeable from our markup.
 * 3. **It can be cached.** An unlocked page is answered with CDN cache headers, so the host
 *    is hit once per edge rather than once per reader.
 *
 * It deliberately stores nothing. That is the point of the mode — the bucket stays empty and
 * the bandwidth is Cloudflare's after the first hit.
 */

const idxSchema = z.coerce.number().int().min(0).max(4000)
const chapterSchema = z.coerce.number().int().positive()

/**
 * An unlocked page is immutable for a week at the edge and an hour in the browser.
 *
 * Not `immutable`: the URL is addressed by chapter and index rather than by content, so an
 * operator reordering or replacing pages would otherwise be serving the old image until the
 * cache aged out, with no way to force it.
 */
const PUBLIC_CACHE = 'public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400'

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ chapter: string; idx: string }> },
) {
  const params = await ctx.params
  const chapterId = chapterSchema.safeParse(params.chapter)
  const idx = idxSchema.safeParse(params.idx)
  if (!chapterId.success || !idx.success) return new Response('Not found', { status: 404 })

  const db = await getDb()
  // One query: the page and the three fields that decide whether this viewer may have it.
  const [row] = await db
    .select({
      remoteUrl: chapterPages.remoteUrl,
      state: chapters.state,
      isPremium: chapters.isPremium,
      earlyAccessUntil: chapters.earlyAccessUntil,
    })
    .from(chapterPages)
    .innerJoin(chapters, eq(chapters.id, chapterPages.chapterId))
    .where(
      and(
        eq(chapterPages.chapterId, chapterId.data),
        eq(chapterPages.idx, idx.data),
        isNull(chapters.deletedAt),
      ),
    )
    .limit(1)
  // A stored page has no business here, and answering 404 rather than falling back to the
  // bucket keeps the two kinds of page from quietly becoming interchangeable.
  if (!row?.remoteUrl) return new Response('Not found', { status: 404 })

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
  const locked = row.isPremium || (row.earlyAccessUntil && row.earlyAccessUntil > now)

  try {
    // Same guard as the import: host allowlist, byte cap, and the type taken from the bytes
    // rather than from the remote host's Content-Type header.
    const image = await downloadGalleryImage(row.remoteUrl, {
      token: getEnv().IMGCHEST_TOKEN,
      maxBytes: MAX_ORIGINAL_BYTES,
    })
    return new Response(image.bytes as BodyInit, {
      headers: {
        'content-type': image.type,
        'content-length': String(image.bytes.byteLength),
        // A locked page is never cached by a shared cache: the entitlement check above is
        // per viewer, and an edge copy would serve it to the next person regardless.
        'cache-control': locked ? 'private, no-store' : PUBLIC_CACHE,
        'x-content-type-options': 'nosniff',
      },
    })
  } catch (error) {
    // 502, not 404: the page exists, the host would not give it to us. The distinction
    // matters when an operator is working out whether a gallery was deleted.
    const code = error instanceof GalleryError ? error.code : 'unavailable'
    return new Response(`Upstream: ${code}`, {
      status: code === 'not_found' ? 404 : 502,
      headers: { 'cache-control': 'no-store' },
    })
  }
}
