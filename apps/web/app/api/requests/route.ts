import { messages } from '@palscans/core/messages'
import { createRequest, getDb, votedRequestIds } from '@palscans/db'
import { createRequestSchema } from '@/components/requests/schemas'
import { loadBoard, toRequestItem } from '@/components/requests/server/data'
import { submitLimit } from '@/components/requests/server/guards'
import { readActor, writeActor } from '@/components/requests/server/identity'
import { isRequestFilter, isRequestSort } from '@/components/requests/shared'
import { fail, ok, parseJson, rateLimited, sameOrigin } from '@/lib/auth'
import { turnstileEnabled, verifyTurnstile } from '@/lib/auth/turnstile'

/**
 * The request board's public API.
 *
 *   GET  /api/requests?status=&sort=&page=   the board, with this viewer's votes marked
 *   POST /api/requests                       file one, or be pointed at the row that exists
 *
 * POST is the only write endpoint on the site that takes free text with no account, so it is
 * gated exactly the way `/dmca` and the comment composer are, in the order that costs least:
 *
 *   1. the Origin check every mutating route does (`sameOrigin`);
 *   2. the honeypot field inside `createRequestSchema`;
 *   3. 3/hour and 10/day per identity (account *and* address), on the shared Redis limiter;
 *   4. Turnstile — a network round trip, so last, and only for anonymous submissions:
 *      an account already passed one at registration and is a far more expensive identity
 *      to mint than a challenge token is to solve.
 *
 * Then the database has the final word: the unique index on the normalised title means the
 * fiftieth person to ask for a title gets the row the other forty-nine are voting on, even
 * if fifty of them submit in the same second.
 */

export async function GET(request: Request) {
  const url = new URL(request.url)
  const filterParam = url.searchParams.get('status')
  const sortParam = url.searchParams.get('sort')
  const pageParam = Number(url.searchParams.get('page') ?? '1')
  const board = await loadBoard({
    filter: isRequestFilter(filterParam) ? filterParam : 'open',
    sort: isRequestSort(sortParam) ? sortParam : 'votes',
    page: Number.isFinite(pageParam) ? Math.min(1000, Math.max(1, Math.floor(pageParam))) : 1,
    actor: await readActor(),
  })
  // Every row carries "have *you* voted for this", so it is never a shared cache entry.
  return ok(board, { headers: { 'cache-control': 'private, no-store' } })
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail(403, 'csrf', messages.errors.forbidden)
  const parsed = await parseJson(request, createRequestSchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const actor = await writeActor()
  const limit = await submitLimit(actor)
  if (!limit.ok) return rateLimited(limit.retryAfterSec)

  if (!actor.userId && (await turnstileEnabled())) {
    const passed = await verifyTurnstile(body.turnstile)
    if (!passed) return fail(403, 'challenge_failed', messages.requests.challengeFailed)
  }

  const db = await getDb()
  let result: Awaited<ReturnType<typeof createRequest>>
  try {
    result = await createRequest(db, {
      title: body.title,
      altTitles: body.altTitles,
      link: body.link,
      type: body.type,
      note: body.note,
      userId: actor.userId,
      requesterKey: actor.voterKey,
      voterKey: actor.voterKey,
    })
  } catch (error) {
    console.error('[requests] could not file a request', error)
    return fail(500, 'failed', messages.requests.failed)
  }

  if (!result.ok) {
    // 409 with the row to upvote, not a bare error: "somebody already asked for this" is
    // only useful to a reader if it comes with the thing they should press instead.
    const voted = await votedRequestIds(db, [result.existing.id], actor)
    return Response.json(
      {
        error: 'duplicate',
        message: messages.requests.duplicate,
        request: toRequestItem(result.existing, voted.has(result.existing.id)),
      },
      { status: 409 },
    )
  }
  return ok(
    { request: toRequestItem(result.request, actor.voterKey !== null), signedIn: !!actor.userId },
    { status: 201 },
  )
}
