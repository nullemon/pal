import { messages } from '@palscans/core/messages'
import { db } from '@palscans/db'
import { clientIp } from '@/lib/auth'
import { turnstileEnabled, verifyTurnstile } from '@/lib/auth/turnstile'
import { rejectResponse } from '@/lib/comments/errors'
import { fail, ipHashFor, ok, parseJson, parseQuery, requireUser } from '@/lib/comments/http'
import { enqueueCommentNotification } from '@/lib/comments/notify'
import { submitComment } from '@/lib/comments/pipeline'
import { getCommentView, listComments, viewerFor } from '@/lib/comments/queries'
import { getRateLimiter } from '@/lib/comments/rate-limit'
import { createCommentSchema, listQuerySchema } from '@/lib/comments/schemas'
import { loadCommentSettings } from '@/lib/comments/settings'
import { parseTarget } from '@/lib/comments/types'
import { getAppUser } from '@/lib/comments/viewer'

/** GET /api/comments?target=series:1&sort=best&cursor=20 — public, cached 60s for anonymous viewers. */
export async function GET(request: Request) {
  const q = parseQuery(request, listQuerySchema)
  if (!q.ok) return q.response
  const target = parseTarget(q.data.target)
  if (!target) return fail(400, 'validation', messages.errors.validation)
  const user = await getAppUser()
  const viewer = await viewerFor(db, user)
  const page = await listComments(db, {
    target,
    sort: q.data.sort,
    cursor: q.data.cursor,
    limit: q.data.limit,
    viewer,
  })
  return ok(page, {
    headers: {
      'cache-control': viewer
        ? 'private, no-store'
        : 'public, s-maxage=60, stale-while-revalidate=300',
    },
  })
}

/** POST /api/comments {target, parent_id?, body, image_id?, is_spoiler?} — the docs/14 §2 pipeline. */
export const POST = requireUser(async (request, _ctx, user) => {
  const parsed = await parseJson(request, createCommentSchema)
  if (!parsed.ok) return parsed.response
  const target = parseTarget(parsed.data.target)
  if (!target) return fail(400, 'validation', messages.errors.validation)
  const settings = await loadCommentSettings(db)

  const outcome = await submitComment({
    db,
    settings,
    user,
    target,
    parentId: parsed.data.parent_id ?? null,
    body: parsed.data.body,
    imageId: parsed.data.image_id ?? null,
    isSpoiler: parsed.data.is_spoiler ?? false,
    ipHash: await ipHashFor(request),
    limiter: getRateLimiter(),
    challenge: {
      enabled: turnstileEnabled(),
      token: parsed.data.turnstile,
      verify: (token) => verifyTurnstile(token, clientIp(request)),
    },
  })
  if (!outcome.ok) {
    const r = rejectResponse(outcome.code, { maxMentions: settings.max_mentions })
    return Response.json(
      { error: outcome.code, message: r.message },
      {
        status: r.status,
        headers: outcome.retryAfterSec
          ? { 'retry-after': String(outcome.retryAfterSec) }
          : undefined,
      },
    )
  }

  const viewer = await viewerFor(db, user)
  const comment = await getCommentView(db, outcome.id, viewer)
  if (outcome.status === 'published') {
    if (parsed.data.parent_id)
      void enqueueCommentNotification({ commentId: outcome.id, kind: 'reply' })
    else if (comment?.body.children.length)
      void enqueueCommentNotification({ commentId: outcome.id, kind: 'mention' })
  }
  const message =
    outcome.status === 'pending'
      ? outcome.hasLink
        ? messages.comments.heldForReview
        : messages.commentThread.awaitingReview
      : parsed.data.parent_id
        ? messages.commentThread.replyPosted
        : messages.commentThread.posted
  return ok({ comment, status: outcome.status, message }, { status: 201 })
})
