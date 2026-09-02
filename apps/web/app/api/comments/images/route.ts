import { communityImages, db } from '@palscans/db'
import { and, desc, eq, sql } from 'drizzle-orm'
import { ok, parseQuery } from '@/lib/comments/http'
import { storageUrl } from '@/lib/comments/media'
import { imageQuerySchema } from '@/lib/comments/schemas'

/**
 * GET /api/comments/images?q=tag — the approved community collection (docs/14 §5).
 * docs/14 §8 names this `/api/community-images`; it lives under /api/comments so the
 * comment system owns it end to end.
 */
export async function GET(request: Request) {
  const q = parseQuery(request, imageQuerySchema)
  if (!q.ok) return q.response
  const tag = q.data.q?.toLowerCase()
  const rows = await db
    .select({
      id: communityImages.id,
      key: communityImages.key,
      width: communityImages.width,
      height: communityImages.height,
      tags: communityImages.tags,
    })
    .from(communityImages)
    .where(
      and(
        eq(communityImages.status, 'approved'),
        eq(communityImages.isCollection, true),
        tag
          ? sql`exists (select 1 from unnest(${communityImages.tags}) t where t ilike ${`%${tag}%`})`
          : undefined,
      ),
    )
    .orderBy(desc(communityImages.id))
    .limit(60)
  return ok(
    {
      images: rows.flatMap((r) => {
        const src = storageUrl(r.key)
        return src ? [{ id: r.id, src, width: r.width, height: r.height, tags: r.tags }] : []
      }),
    },
    { headers: { 'cache-control': 'public, s-maxage=300' } },
  )
}
