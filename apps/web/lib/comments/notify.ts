import { messages } from '@palscans/core/messages'
import type { JobMap } from '@palscans/core/queue'
import {
  chapters,
  commentMentions,
  comments,
  type Db,
  notifications,
  series,
  userBlocks,
  users,
} from '@palscans/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { type DeliveryInput, deliveredKeys, recordDeliveries } from '../notifications/deliveries'
import { loadPrefs, prefAllows } from '../notifications/prefs'
import { type PushPayload, type PushSender, sendPush } from '../notifications/push'
import { getRateLimiter, type RateLimiter } from './rate-limit'

/**
 * Replies and `@mentions` (docs/14 "Notifications"). The comment schema has carried
 * `comment_mentions` and the `reply` / `mention` notification kinds from the start; nothing
 * ever sent one, so being replied to or named was invisible.
 *
 * Four rules decide who hears about a comment, and all four are here rather than spread
 * across the pipeline and the worker:
 *
 *  1. **Never yourself.** Replying to your own thread, or typing your own name, notifies
 *     nobody.
 *  2. **Blocks are absolute, in both directions.** `user_blocks` is "their comments are
 *     hidden from me"; a mention is a way to reach someone their block list already said
 *     they do not want to hear from, so a block either way suppresses the notice. The
 *     comment itself is still posted — a block is not a moderation action.
 *  3. **Preferences.** The same `notification_prefs` matrix every other sender consults.
 *     Replies and mentions share the `reply` kind, which is the only "someone talked to
 *     you" row the matrix has; see `MENTION_PREF_KIND`.
 *  4. **Caps.** A mention must not be a broadcast primitive — see the three constants below.
 *
 * The fan-out is idempotent on a `notification_deliveries` dedupe key, exactly like the
 * chapter one, so the submit path and the worker's safety-net sweep can both call it and
 * only one of them sends.
 */

/** Best-effort queue job, kept for parity with the rest of the notification jobs. */
export const enqueueCommentNotification = async (data: JobMap['notify.comment']): Promise<void> => {
  try {
    const { getQueue } = await import('@palscans/core/queue')
    const queue = await getQueue()
    await queue.add('notify.comment', data, {
      jobId: `notify.comment:${data.commentId}:${data.kind}`,
    })
  } catch {
    // ignore: notifications are a nicety, the comment is already stored
  }
}

// -- anti-spam limits ----------------------------------------------------------------------

/**
 * The `notification_prefs` kind replies **and mentions** are filed under.
 *
 * The matrix ships four kinds (`new_chapter`, `reply`, `reaction`, `announcement`) and a
 * mention is not one of them. Rather than send mentions that no reader can switch off — the
 * matrix is the promise that every channel is refusable — they ride on `reply`, which is the
 * row that already means "someone addressed me". Splitting them into their own kind is a
 * one-line change to `NOTIFICATION_KINDS` in `lib/auth/schemas.ts` plus a label, and this
 * constant is the single place that would have to move.
 */
export const MENTION_PREF_KIND = 'reply'

/** Per comment. Matches `COMMENT_MAX_MENTIONS` and the default `max_mentions` setting. */
export const MAX_MENTION_NOTIFICATIONS = 5

/**
 * Per author, per hour, across all comments. Twenty is far above a person talking to people
 * (the comment rate limit itself is 60 comments an hour) and far below anything that reads
 * as a mailing list. Over the limit the mentions are still parsed, linked and recorded —
 * only the notifications stop, so throttling never rewrites what a comment says.
 */
export const MENTION_NOTIFY_PER_HOUR = 20

/**
 * Per author → recipient pair, per hour. The global cap above still lets one account spend
 * its whole budget on one person; this is the part that stops targeted pinging, which is the
 * shape mention abuse actually takes.
 */
export const MENTION_NOTIFY_PER_PAIR_PER_HOUR = 3

/**
 * Per author → recipient pair, per hour, for replies. Higher than the mention cap because a
 * real back-and-forth is replies, and both people have already opted into the thread; still
 * low enough that a reply flood is one notification storm instead of sixty.
 */
export const REPLY_NOTIFY_PER_PAIR_PER_HOUR = 10

export const mentionHourKey = (authorId: number) => `notify:mention:u:${authorId}:h`
export const mentionPairKey = (authorId: number, targetId: number) =>
  `notify:mention:${authorId}:${targetId}:h`
export const replyPairKey = (authorId: number, targetId: number) =>
  `notify:reply:${authorId}:${targetId}:h`

// -- who hears about it (pure) --------------------------------------------------------------

export type CommentNoticeKind = 'reply' | 'mention'

export interface CommentNoticeTarget {
  userId: number
  kind: CommentNoticeKind
}

export interface TargetInput {
  authorId: number
  /** Author of the comment being replied to, if this is a reply to a live comment. */
  parentAuthorId: number | null
  mentionedIds: readonly number[]
  /** Every `(a, b)` pair in `user_blocks`, in either direction, as `a:b`. */
  blockedPairs: ReadonlySet<string>
  maxMentions?: number
}

export const blockPairKey = (a: number, b: number) => `${a}:${b}`

/**
 * The recipient list, before preferences and rate limits: rules 1, 2 and the per-comment cap
 * of rule 4. A reply beats a mention for the same person — being replied to is the more
 * specific fact, and two notifications for one comment is one too many.
 */
export const commentNoticeTargets = (input: TargetInput): CommentNoticeTarget[] => {
  const blocked = (other: number) =>
    input.blockedPairs.has(blockPairKey(input.authorId, other)) ||
    input.blockedPairs.has(blockPairKey(other, input.authorId))
  const out: CommentNoticeTarget[] = []
  const taken = new Set<number>([input.authorId])
  if (
    input.parentAuthorId !== null &&
    !taken.has(input.parentAuthorId) &&
    !blocked(input.parentAuthorId)
  ) {
    out.push({ userId: input.parentAuthorId, kind: 'reply' })
    taken.add(input.parentAuthorId)
  }
  const cap = Math.max(0, input.maxMentions ?? MAX_MENTION_NOTIFICATIONS)
  let used = 0
  for (const id of input.mentionedIds) {
    if (used >= cap) break
    if (taken.has(id) || blocked(id)) continue
    out.push({ userId: id, kind: 'mention' })
    taken.add(id)
    used += 1
  }
  return out
}

// -- the fan-out ----------------------------------------------------------------------------

export interface CommentNoticeDeps {
  limiter?: RateLimiter
  pushSender?: PushSender
  /** Skip push entirely (the sweep passes this when push is off in settings). */
  push?: boolean
  ttlSeconds?: number
  now?: Date
}

export interface CommentNoticeSummary {
  commentId: number
  inApp: number
  push: { sent: number; failed: number }
  skipped: number
  rateLimited: number
}

const empty = (commentId: number): CommentNoticeSummary => ({
  commentId,
  inApp: 0,
  push: { sent: 0, failed: 0 },
  skipped: 0,
  rateLimited: 0,
})

/** Every block touching these two accounts, in either direction, as `a:b` keys. */
export const loadBlockPairs = async (db: Db, userIds: readonly number[]): Promise<Set<string>> => {
  const ids = [...new Set(userIds)]
  if (ids.length < 2) return new Set()
  const rows = await db
    .select({ blockerId: userBlocks.blockerId, blockedId: userBlocks.blockedId })
    .from(userBlocks)
    .where(and(inArray(userBlocks.blockerId, ids), inArray(userBlocks.blockedId, ids)))
  return new Set(rows.map((r) => blockPairKey(r.blockerId, r.blockedId)))
}

/** The comment, its thread and where it lives — one read for the whole fan-out. */
const loadComment = async (db: Db, commentId: number) => {
  const [row] = await db
    .select({
      id: comments.id,
      userId: comments.userId,
      parentId: comments.parentId,
      status: comments.status,
      deletedAt: comments.deletedAt,
      chapterId: comments.chapterId,
      seriesId: comments.seriesId,
      authorName: users.displayName,
      authorUsername: users.username,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .where(eq(comments.id, commentId))
    .limit(1)
  return row ?? null
}

const loadThreadTarget = async (
  db: Db,
  row: { seriesId: number | null; chapterId: number | null },
) => {
  if (row.chapterId !== null) {
    const [c] = await db
      .select({
        number: chapters.number,
        seriesTitle: series.title,
        seriesSlug: series.slug,
      })
      .from(chapters)
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .where(and(eq(chapters.id, row.chapterId), isNull(chapters.deletedAt)))
      .limit(1)
    if (!c) return null
    return {
      title: c.seriesTitle,
      href: `/series/${c.seriesSlug}/chapter-${c.number}`,
    }
  }
  if (row.seriesId === null) return null
  const [s] = await db
    .select({ title: series.title, slug: series.slug })
    .from(series)
    .where(and(eq(series.id, row.seriesId), isNull(series.deletedAt)))
    .limit(1)
  if (!s) return null
  return { title: s.title, href: `/series/${s.slug}` }
}

/**
 * Notify the parent comment's author and everyone the comment mentions, once.
 *
 * Idempotent: the dedupe key is `comment:<id>:<kind>`, so the submit path and the worker's
 * sweep can both call this and the second one sends nothing.
 */
export const fanoutCommentNotice = async (
  db: Db,
  commentId: number,
  deps: CommentNoticeDeps = {},
): Promise<CommentNoticeSummary> => {
  const summary = empty(commentId)
  const row = await loadComment(db, commentId)
  // A held, shadow-banned or deleted comment tells nobody anything.
  if (row?.status !== 'published' || row.deletedAt !== null) return summary

  const [parentRow] = row.parentId
    ? await db
        .select({ userId: comments.userId })
        .from(comments)
        .where(and(eq(comments.id, row.parentId), isNull(comments.deletedAt)))
        .limit(1)
    : [undefined]
  const mentionRows = await db
    .select({ userId: commentMentions.userId })
    .from(commentMentions)
    .innerJoin(users, eq(users.id, commentMentions.userId))
    .where(and(eq(commentMentions.commentId, commentId), isNull(users.deletedAt)))

  const parentAuthorId = parentRow?.userId ?? null
  const mentionedIds = mentionRows.map((m) => m.userId)
  if (parentAuthorId === null && mentionedIds.length === 0) return summary

  const blockedPairs = await loadBlockPairs(
    db,
    [row.userId, parentAuthorId, ...mentionedIds].filter((id): id is number => id !== null),
  )
  const targets = commentNoticeTargets({
    authorId: row.userId,
    parentAuthorId,
    mentionedIds,
    blockedPairs,
  })
  if (targets.length === 0) return summary

  const keys = [`comment:${commentId}:reply`, `comment:${commentId}:mention`]
  const done = await deliveredKeys(db, keys)
  const pending = targets.filter((t) => !done.has(`comment:${commentId}:${t.kind}`))
  if (pending.length === 0) return summary

  // Rate limits (rule 4). A refusal is recorded in the ledger rather than dropped silently,
  // so "why did I not hear about that mention?" has an answer in Admin -> Notifications.
  const limiter = deps.limiter ?? getRateLimiter()
  const allowed: CommentNoticeTarget[] = []
  for (const t of pending) {
    if (t.kind === 'mention') {
      const hour = await limiter.hit(mentionHourKey(row.userId), MENTION_NOTIFY_PER_HOUR, 3600)
      const pair = await limiter.hit(
        mentionPairKey(row.userId, t.userId),
        MENTION_NOTIFY_PER_PAIR_PER_HOUR,
        3600,
      )
      if (!hour.ok || !pair.ok) {
        summary.rateLimited += 1
        await recordDeliveries(db, [
          {
            userId: t.userId,
            kind: t.kind,
            channel: 'in_app',
            status: 'skipped',
            detail: hour.ok ? 'mention pair rate limit' : 'mention hourly rate limit',
            dedupeKey: `comment:${commentId}:${t.kind}`,
          },
        ])
        continue
      }
    } else {
      const pair = await limiter.hit(
        replyPairKey(row.userId, t.userId),
        REPLY_NOTIFY_PER_PAIR_PER_HOUR,
        3600,
      )
      if (!pair.ok) {
        summary.rateLimited += 1
        await recordDeliveries(db, [
          {
            userId: t.userId,
            kind: t.kind,
            channel: 'in_app',
            status: 'skipped',
            detail: 'reply pair rate limit',
            dedupeKey: `comment:${commentId}:${t.kind}`,
          },
        ])
        continue
      }
    }
    allowed.push(t)
  }
  if (allowed.length === 0) return summary

  const where = await loadThreadTarget(db, row)
  if (!where) return summary
  const actor = row.authorName ?? row.authorUsername ?? messages.notify.digest.reader
  const href = `${where.href}#comment-${commentId}`
  const prefs = await loadPrefs(
    db,
    allowed.map((t) => t.userId),
  )

  const inAppRows: Array<{ userId: number; kind: string; payload: Record<string, unknown> }> = []
  const pushTargets: Array<{ userId: number; kind: CommentNoticeKind }> = []
  const ledger: DeliveryInput[] = []
  for (const t of allowed) {
    const title = (
      t.kind === 'reply' ? messages.commentNotify.reply : messages.commentNotify.mention
    ).replace('{name}', actor)
    const payload = {
      title,
      body: messages.commentNotify.onSeries.replace('{title}', where.title),
      href,
      commentId,
      kind: t.kind,
    }
    if (prefAllows(prefs, t.userId, MENTION_PREF_KIND, 'in_app'))
      inAppRows.push({ userId: t.userId, kind: t.kind, payload })
    else
      ledger.push({
        userId: t.userId,
        kind: t.kind,
        channel: 'in_app',
        status: 'skipped',
        detail: 'preference off',
        dedupeKey: `comment:${commentId}:${t.kind}`,
      })
    if (prefAllows(prefs, t.userId, MENTION_PREF_KIND, 'push')) pushTargets.push(t)
  }

  if (inAppRows.length) {
    await db.insert(notifications).values(
      inAppRows.map((r) => ({
        userId: r.userId,
        kind: r.kind,
        payload: r.payload,
        // Collapses a busy thread into one line in the bell.
        groupKey: row.parentId ? `comment:${row.parentId}` : `comment:${commentId}`,
      })),
    )
    summary.inApp = inAppRows.length
    for (const r of inAppRows)
      ledger.push({
        userId: r.userId,
        kind: r.kind,
        channel: 'in_app',
        status: 'sent',
        dedupeKey: `comment:${commentId}:${r.kind}`,
      })
  }
  summary.skipped = allowed.length - inAppRows.length
  await recordDeliveries(db, ledger)

  if (deps.push !== false && pushTargets.length) {
    for (const kind of ['reply', 'mention'] as const) {
      const ids = pushTargets.filter((t) => t.kind === kind).map((t) => t.userId)
      if (ids.length === 0) continue
      const payload: PushPayload = {
        title:
          kind === 'reply' ? messages.commentNotify.pushReply : messages.commentNotify.pushMention,
        body: (kind === 'reply'
          ? messages.commentNotify.reply
          : messages.commentNotify.mention
        ).replace('{name}', actor),
        url: href,
        tag: `comment:${row.parentId ?? commentId}`,
        kind,
      }
      const res = await sendPush(db, ids, payload, {
        kind,
        ttlSeconds: deps.ttlSeconds,
        dedupeKey: `comment:${commentId}:${kind}`,
        sender: deps.pushSender,
      })
      summary.push.sent += res.sent
      summary.push.failed += res.failed
    }
  }
  return summary
}

/**
 * The submit path's call: never throws, never blocks the response on a push service. The
 * comment is already stored by the time this runs, and the worker's sweep will pick up
 * anything that fails here.
 */
export const notifyForComment = async (db: Db, commentId: number): Promise<void> => {
  try {
    await fanoutCommentNotice(db, commentId)
  } catch {
    // ignore: the sweep in apps/worker retries, and a failed notice must not fail a comment
  }
}
