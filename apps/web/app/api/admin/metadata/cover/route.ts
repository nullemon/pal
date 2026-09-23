import { getDb, series } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/components/admin/server/audit'
import { attachCover } from '@/components/admin/server/metadata'
import {
  fail,
  getRateLimiter,
  notFound,
  ok,
  parseJson,
  rateLimited,
  withPermission,
} from '@/lib/auth'
import { metadataById } from '@/lib/metadata/anilist'

/**
 * POST /api/admin/metadata/cover — fetch an AniList candidate's cover onto an existing series.
 *
 * Split from the import route because it is a different act on a different object: import
 * *creates* series (`series.create`), this *edits* one the operator already has open in the
 * editor (`series.update`). The lookup dialog fills the text fields in the browser and the
 * operator saves them with everything else, but a cover cannot travel that way — it has to be
 * downloaded server-side and pushed through `series.art`, so it lands here on its own.
 *
 * Applied immediately rather than on save, and deliberately: `coverKey` only changes once the
 * worker has re-encoded the original, so there is nothing half-applied to roll back if the
 * operator then presses Discard. The old cover keeps serving until the new one is ready.
 */
const body = z.object({
  seriesId: z.number().int().positive(),
  anilistId: z.number().int().positive(),
})

export const POST = withPermission('series.update', async (request, _ctx, user) => {
  const parsed = await parseJson(request, body)
  if (!parsed.ok) return parsed.response

  const hit = await getRateLimiter().hit(`metadata-cover:${user.id}`, 30, 300)
  if (!hit.ok) return rateLimited(hit.retryAfterSec)

  const db = await getDb()
  const [row] = await db
    .select({ id: series.id })
    .from(series)
    .where(eq(series.id, parsed.data.seriesId))
    .limit(1)
  if (!row) return notFound()

  const found = await metadataById(parsed.data.anilistId)
  if (!found.ok)
    return found.code === 'rate_limited'
      ? rateLimited(found.retryAfterSec)
      : fail(502, 'source_unavailable')
  if (!found.data.coverUrl) return ok({ queued: false })

  const queued = await attachCover(row.id, found.data.coverUrl, user.id)
  if (queued)
    await audit({
      actorId: user.id,
      action: 'series.cover',
      targetType: 'series',
      targetId: row.id,
      after: { source: 'anilist', anilistId: parsed.data.anilistId },
    })
  return ok({ queued })
})
