import { commentMentions, comments, type Db } from '@palscans/db'
import { and, asc, eq, exists, gt, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { type CommentNoticeSummary, fanoutCommentNotice } from '../../../web/lib/comments/notify.js'
import type { NotificationSettings } from '../../../web/lib/notifications/index.js'
import { log } from '../lib/log.js'

/**
 * Replies and `@mentions`, as a safety net (docs/14 "Notifications").
 *
 * The notice is sent by the submit path itself, in `apps/web/lib/comments/pipeline.ts`, so a
 * reader who is replied to hears about it at once rather than on the next worker tick. This
 * is the same **sweep, not hook** pattern `notify-chapter.ts` uses for the same reason: the
 * web process can die between the insert and the send, and `fanoutCommentNotice` is
 * idempotent on a `notification_deliveries` dedupe key, so re-running it is free.
 *
 * The scan is a primary-key range from a watermark rather than a `created_at` window,
 * because `comments` has no global `created_at` index and never should — a sweep must not
 * cost a sequential scan of the busiest table on the site every minute.
 */
export interface CommentSweepDeps {
  settings: NotificationSettings
  /** Only comments after this id are considered; the sweep advances it. */
  after: number
  limit?: number
}

export interface CommentSweepResult {
  /** The new watermark — the highest comment id this pass looked at. */
  after: number
  considered: number
  summaries: CommentNoticeSummary[]
}

/** The id to start from on a cold start: the newest comment, so history is not replayed. */
export const latestCommentId = async (db: Db): Promise<number> => {
  const [row] = await db
    .select({ id: sql<number>`coalesce(max(${comments.id}), 0)::int` })
    .from(comments)
  return Number(row?.id ?? 0)
}

/** Comments after `after` that can notify somebody: a reply, or a comment with a mention. */
export const notifiableComments = async (
  db: Db,
  after: number,
  limit: number,
): Promise<number[]> => {
  const rows = await db
    .select({ id: comments.id })
    .from(comments)
    .where(
      and(
        gt(comments.id, after),
        eq(comments.status, 'published'),
        isNull(comments.deletedAt),
        or(
          isNotNull(comments.parentId),
          exists(
            db
              .select({ one: sql`1` })
              .from(commentMentions)
              .where(eq(commentMentions.commentId, comments.id)),
          ),
        ),
      ),
    )
    .orderBy(asc(comments.id))
    .limit(limit)
  return rows.map((r) => r.id)
}

export const sweepCommentNotices = async (
  db: Db,
  deps: CommentSweepDeps,
): Promise<CommentSweepResult> => {
  const limit = deps.limit ?? 100
  const ids = await notifiableComments(db, deps.after, limit)
  const summaries: CommentNoticeSummary[] = []
  for (const id of ids) {
    try {
      summaries.push(
        await fanoutCommentNotice(db, id, {
          push: deps.settings.push.enabled,
          ttlSeconds: deps.settings.push.ttlSeconds,
        }),
      )
    } catch (err) {
      log.error(`notify.comment ${id} failed`, err)
    }
  }
  // A page that came back full leaves the watermark at the last id seen, so the next tick
  // picks up where this one stopped instead of skipping the tail.
  const after = ids.length ? Math.max(deps.after, ...ids) : deps.after
  return { after, considered: ids.length, summaries }
}

/** One comment on demand — the `notify.comment` queue job. */
export const notifyOneComment = async (
  db: Db,
  commentId: number,
  settings: NotificationSettings,
): Promise<CommentNoticeSummary> =>
  fanoutCommentNotice(db, commentId, {
    push: settings.push.enabled,
    ttlSeconds: settings.push.ttlSeconds,
  })
