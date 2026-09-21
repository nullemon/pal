import { getDb, mergeGenres } from '@palscans/db'
import { revalidateTag } from 'next/cache'
import { genreMergeSchema } from '@/components/admin/schemas-genres'
import { purgeCatalog } from '@/components/admin/server/cache'
import { fail, ok, parseJson, withPermission } from '@/lib/auth'

/**
 * `POST /api/admin/genres/merge { winnerId, loserId }` — fold one genre into another.
 *
 * Permission: **`series.delete`**, matching `/api/admin/series/merge`. A merge retires a row
 * and rewrites every series that carried it, which is the same class of irreversible
 * catalogue change; `series.update` would let a moderator do it, and a moderator who picks
 * the wrong winner cannot undo it.
 *
 * The route holds no state from the preview the operator looked at. It sends two ids;
 * `mergeGenres` recomputes the preview inside the transaction under a row lock and refuses
 * there, so a preview that went stale between render and click cannot be confirmed — and a
 * refusal writes nothing at all. The audit row is written inside the same transaction.
 */
export const POST = withPermission('series.delete', async (request, _ctx, user) => {
  const parsed = await parseJson(request, genreMergeSchema)
  if (!parsed.ok) return parsed.response
  const { winnerId, loserId } = parsed.data
  const db = await getDb()
  const result = await mergeGenres(db, {
    winnerId,
    loserId,
    actorId: user.id,
  })
  if (!result.ok) return fail(409, 'merge_refused', result.refusals.map((r) => r.message).join(' '))
  // /genres, the browse filters and every series page that showed the loser's chip change at
  // once; `redirects` is the proxy snapshot's own tag, without which /genres/<loser> would
  // keep 404ing for up to its 60s TTL.
  purgeCatalog()
  revalidateTag('redirects', 'max')
  return ok({
    winnerId,
    loserId,
    winnerSlug: result.preview.winner.slug,
    move: result.preview.move,
    merge: result.preview.merge,
    redirect: result.preview.redirect,
    tombstoneSlug: result.preview.tombstoneSlug,
    auditId: result.auditId,
  })
})
