import { messages } from '@palscans/core/messages'
import { getDb, unvoteRequest, voteForRequest } from '@palscans/db'
import { voteLimit } from '@/components/requests/server/guards'
import { writeActor } from '@/components/requests/server/identity'
import { voteSchema } from '@/components/requests/shared'
import {
  fail,
  notFound,
  ok,
  parseJson,
  type RouteParams,
  rateLimited,
  sameOrigin,
} from '@/lib/auth'

/**
 * `POST /api/requests/:id/vote` — cast or withdraw one vote.
 *
 * There is no bot challenge here on purpose. A vote is a single row keyed by
 * `(request_id, voter_key)`, so the *identity* is the defence: solving a Turnstile does not
 * give a script a second identity, and asking a reader to solve one to press an arrow would
 * cost more honest votes than it would stop dishonest ones. What stops a script is the
 * primary key, then the hourly budget, and — for anything more determined than that — the
 * fact that a vote is only worth forging if someone is watching the number, which is exactly
 * when staff will notice a title that arrived from one address in one hour.
 */
export async function POST(request: Request, ctx: RouteParams<{ id: string }>) {
  if (!sameOrigin(request)) return fail(403, 'csrf', messages.errors.forbidden)
  const id = Number((await ctx.params).id)
  if (!Number.isInteger(id) || id <= 0) return notFound()
  const parsed = await parseJson(request, voteSchema)
  if (!parsed.ok) return parsed.response

  const actor = await writeActor()
  // No account, no address, no cookie: refuse rather than pool every such reader into one
  // shared key, which would let the first of them block the rest.
  if (!actor.voterKey) return fail(400, 'no_identity', messages.requests.noIdentity)
  const limit = await voteLimit(actor)
  if (!limit.ok) return rateLimited(limit.retryAfterSec)

  const db = await getDb()
  const input = { requestId: id, voterKey: actor.voterKey, userId: actor.userId }
  const result = parsed.data.vote ? await voteForRequest(db, input) : await unvoteRequest(db, input)
  if (!result.ok) return notFound()
  return ok({ id, voted: result.voted, voteCount: result.voteCount })
}
