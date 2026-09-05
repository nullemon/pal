import { getDb, mergeSeries } from '@palscans/db'
import { revalidateTag } from 'next/cache'
import { z } from 'zod'
import { purgeCatalog } from '@/components/admin/server/cache'
import { clientIp, fail, hashIp, ok, parseJson, withPermission } from '@/lib/auth'

/**
 * `POST /api/admin/series/merge { winnerId, loserId }` — fold one series into another
 * (docs/09 legacy import, docs/12 §7).
 *
 * Permission: **`series.delete`**, matching `/admin/series/merge`. A merge retires a series
 * row and rewrites every reader association that pointed at it, so it belongs with the
 * permission that already gates removing a series rather than with `series.update`.
 *
 * The route holds no state from the preview the operator looked at. It sends two ids;
 * `mergeSeries` recomputes the whole preview inside the transaction under `FOR UPDATE`, and
 * refuses there — a preview that went stale between render and click cannot be confirmed,
 * and a refusal writes nothing at all. The audit row is written inside the same transaction,
 * so there is no state where the rows moved and the record of it did not.
 */

const schema = z.object({
  winnerId: z.number().int().positive(),
  loserId: z.number().int().positive(),
})

export const POST = withPermission('series.delete', async (request, _ctx, user) => {
  const parsed = await parseJson(request, schema)
  if (!parsed.ok) return parsed.response
  const { winnerId, loserId } = parsed.data
  const db = await getDb()
  const result = await mergeSeries(db, {
    winnerId,
    loserId,
    actorId: user.id,
    ipHash: hashIp(clientIp(request)),
  })
  if (!result.ok) return fail(409, 'merge_refused', result.refusals.map((r) => r.message).join(' '))
  // Series pages, browse and search all change at once; `redirects` is the proxy snapshot's
  // own tag, without which /series/<loser> would keep 404ing for up to its 60s TTL.
  purgeCatalog()
  revalidateTag('redirects', 'max')
  return ok({
    winnerId,
    loserId,
    winnerSlug: result.preview.winner.slug,
    totals: result.preview.totals,
    redirect: result.preview.redirect,
    tombstoneSlug: result.preview.tombstoneSlug,
    auditId: result.auditId,
  })
})
