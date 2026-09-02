import { can, entitlement, isStaff } from '@palscans/core'
import type { CommentBody } from '@palscans/core/comments'
import {
  type CommentBodyJson,
  commentReactions,
  comments,
  communityImages,
  type Db,
  entitlements,
  userBlocks,
  users,
} from '@palscans/db'
import { and, asc, desc, eq, gt, inArray, isNull, notInArray, or, sql } from 'drizzle-orm'
import { storageUrl } from './media'
import { MAX_CURSOR } from './schemas'
import type {
  CommentAuthor,
  CommentImage,
  CommentPage,
  CommentSort,
  CommentTarget,
  CommentView,
  CommentViewer,
  ReactionKind,
} from './types'
import type { AppUser } from './viewer'

export const PAGE_SIZE = 20
const REPLY_PREVIEW = 2

const cols = {
  id: comments.id,
  userId: comments.userId,
  seriesId: comments.seriesId,
  chapterId: comments.chapterId,
  parentId: comments.parentId,
  body: comments.body,
  isSpoiler: comments.isSpoiler,
  isPinned: comments.isPinned,
  score: comments.score,
  status: comments.status,
  imageId: comments.imageId,
  locked: comments.locked,
  reactionCounts: comments.reactionCounts,
  replyCount: comments.replyCount,
  editedAt: comments.editedAt,
  createdAt: comments.createdAt,
  deletedAt: comments.deletedAt,
} as const

type Row = {
  id: number
  userId: number
  seriesId: number | null
  chapterId: number | null
  parentId: number | null
  body: CommentBodyJson
  isSpoiler: boolean
  isPinned: boolean
  score: number
  status: (typeof comments.$inferSelect)['status']
  imageId: number | null
  locked: boolean
  reactionCounts: Partial<Record<ReactionKind, number>>
  replyCount: number
  editedAt: Date | null
  createdAt: Date
  deletedAt: Date | null
}

const DELETED_BODY: CommentBody = { type: 'doc', version: 1, children: [] }

/** The viewer as the thread needs it (null for anonymous). */
export const viewerFor = async (db: Db, user: AppUser | null): Promise<CommentViewer | null> => {
  if (!user) return null
  const blocked = await db
    .select({ id: userBlocks.blockedId })
    .from(userBlocks)
    .where(eq(userBlocks.blockerId, user.id))
  return {
    id: user.id,
    username: user.username ?? `user${user.id}`,
    displayName: user.displayName ?? user.username ?? `user${user.id}`,
    avatarUrl: storageUrl(user.avatarKey),
    role: user.role,
    isPremium: entitlement(user, 'premium_content') || user.role === 'premium',
    verified: !!user.emailVerifiedAt,
    canModerate: can(user, 'comment.moderate'),
    blockedIds: blocked.map((b) => b.id),
  }
}

/** Rows the viewer may see: published, or their own pending/shadow ones; deleted only as stubs. */
const visibleWhere = (viewer: CommentViewer | null) => {
  const alive = or(isNull(comments.deletedAt), gt(comments.replyCount, 0))
  const status = viewer
    ? or(
        eq(comments.status, 'published'),
        and(inArray(comments.status, ['pending', 'shadow']), eq(comments.userId, viewer.id)),
      )
    : eq(comments.status, 'published')
  const notBlocked =
    viewer && viewer.blockedIds.length > 0
      ? notInArray(comments.userId, viewer.blockedIds)
      : undefined
  return and(alive, status, notBlocked)
}

const targetWhere = (t: CommentTarget) =>
  t.kind === 'series'
    ? and(eq(comments.seriesId, t.id), isNull(comments.chapterId))
    : eq(comments.chapterId, t.id)

/** docs/14 §1: score with a 24h half-life; Premium authors first among equals. */
const decayed = sql<number>`(${comments.score} * power(0.5, extract(epoch from (now() - ${comments.createdAt})) / 86400.0))`
const authorPremium = sql<boolean>`exists (select 1 from ${entitlements} e where e.user_id = ${comments.userId} and e.feature = 'premium_content' and (e.expires_at is null or e.expires_at > now()))`

const orderFor = (sort: CommentSort) => {
  switch (sort) {
    case 'newest':
      return [desc(comments.isPinned), desc(comments.createdAt), desc(comments.id)]
    case 'oldest':
      return [desc(comments.isPinned), asc(comments.createdAt), asc(comments.id)]
    default:
      return [
        desc(comments.isPinned),
        desc(decayed),
        desc(authorPremium),
        desc(comments.createdAt),
        desc(comments.id),
      ]
  }
}

/** An offset cursor, clamped to [0, MAX_CURSOR] (the schema rejects more; this mirrors it). */
export const parseCursor = (cursor: string | number | undefined): number => {
  if (cursor === undefined || cursor === '') return 0
  const n = typeof cursor === 'number' ? cursor : Number.parseInt(cursor, 10)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(Math.floor(n), MAX_CURSOR)
}

interface Enrichment {
  authors: Map<number, CommentAuthor>
  images: Map<number, CommentImage>
  viewerReactions: Map<number, ReactionKind[]>
}

const enrich = async (db: Db, rows: Row[], viewer: CommentViewer | null): Promise<Enrichment> => {
  const userIds = [...new Set(rows.map((r) => r.userId))]
  const imageIds = [...new Set(rows.flatMap((r) => (r.imageId ? [r.imageId] : [])))]
  const commentIds = rows.map((r) => r.id)
  const now = new Date()

  const [authorRows, premiumRows, imageRows, reactionRows] = await Promise.all([
    userIds.length
      ? db
          .select({
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            avatarKey: users.avatarKey,
            role: users.role,
          })
          .from(users)
          .where(inArray(users.id, userIds))
      : Promise.resolve([]),
    userIds.length
      ? db
          .select({ userId: entitlements.userId })
          .from(entitlements)
          .where(
            and(
              inArray(entitlements.userId, userIds),
              eq(entitlements.feature, 'premium_content'),
              or(isNull(entitlements.expiresAt), gt(entitlements.expiresAt, now)),
            ),
          )
      : Promise.resolve([]),
    imageIds.length
      ? db
          .select({
            id: communityImages.id,
            key: communityImages.key,
            width: communityImages.width,
            height: communityImages.height,
            status: communityImages.status,
          })
          .from(communityImages)
          .where(inArray(communityImages.id, imageIds))
      : Promise.resolve([]),
    viewer && commentIds.length
      ? db
          .select({ commentId: commentReactions.commentId, kind: commentReactions.kind })
          .from(commentReactions)
          .where(
            and(
              eq(commentReactions.userId, viewer.id),
              inArray(commentReactions.commentId, commentIds),
            ),
          )
      : Promise.resolve([]),
  ])

  const premium = new Set(premiumRows.map((p) => p.userId))
  const authors = new Map<number, CommentAuthor>()
  for (const u of authorRows) {
    authors.set(u.id, {
      id: u.id,
      username: u.username ?? `user${u.id}`,
      displayName: u.displayName ?? u.username ?? `user${u.id}`,
      avatarUrl: storageUrl(u.avatarKey),
      role: u.role,
      isPremium: premium.has(u.id) || u.role === 'premium',
    })
  }
  const images = new Map<number, CommentImage>()
  for (const img of imageRows) {
    if (img.status === 'removed') continue
    const src = storageUrl(img.key)
    if (src) images.set(img.id, { id: img.id, src, width: img.width, height: img.height })
  }
  const viewerReactions = new Map<number, ReactionKind[]>()
  for (const r of reactionRows) {
    const list = viewerReactions.get(r.commentId) ?? []
    list.push(r.kind as ReactionKind)
    viewerReactions.set(r.commentId, list)
  }
  return { authors, images, viewerReactions }
}

const toView = (row: Row, e: Enrichment, replies: CommentView[] = []): CommentView => {
  const deleted = row.deletedAt !== null
  const author = e.authors.get(row.userId) ?? {
    id: row.userId,
    username: `user${row.userId}`,
    displayName: `user${row.userId}`,
    avatarUrl: null,
    role: 'user' as const,
    isPremium: false,
  }
  return {
    id: row.id,
    parentId: row.parentId,
    author,
    body: deleted ? DELETED_BODY : (row.body as CommentBody),
    isSpoiler: row.isSpoiler && !deleted,
    isPinned: row.isPinned,
    status: row.status === 'pending' || row.status === 'shadow' ? row.status : 'published',
    score: row.score,
    reactionCounts: row.reactionCounts ?? {},
    viewerReactions: e.viewerReactions.get(row.id) ?? [],
    replyCount: row.replyCount,
    replies,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    deleted,
    locked: row.locked,
    image: !deleted && row.imageId ? (e.images.get(row.imageId) ?? null) : null,
  }
}

/** First `REPLY_PREVIEW` visible replies per parent, chronological (window function). */
const replyPreviews = async (db: Db, parentIds: number[], viewer: CommentViewer | null) => {
  if (parentIds.length === 0) return new Map<number, Row[]>()
  const ranked = db
    .select({
      ...cols,
      rn: sql<number>`row_number() over (partition by ${comments.parentId} order by ${comments.createdAt}, ${comments.id})`.as(
        'rn',
      ),
    })
    .from(comments)
    .where(and(inArray(comments.parentId, parentIds), visibleWhere(viewer)))
    .as('ranked')
  const rows = await db
    .select()
    .from(ranked)
    .where(sql`${ranked.rn} <= ${REPLY_PREVIEW}`)
    .orderBy(asc(ranked.parentId), asc(ranked.createdAt))
  const out = new Map<number, Row[]>()
  for (const r of rows) {
    const { rn: _rn, ...row } = r
    const list = out.get(row.parentId as number) ?? []
    list.push(row as Row)
    out.set(row.parentId as number, list)
  }
  return out
}

export interface ListOptions {
  target: CommentTarget
  sort: CommentSort
  cursor?: string | number
  limit?: number
  viewer: CommentViewer | null
}

/** docs/14 §8 GET /api/comments — a page of top-level comments with reply previews. */
export const listComments = async (db: Db, opts: ListOptions): Promise<CommentPage> => {
  const limit = Math.min(50, Math.max(1, opts.limit ?? PAGE_SIZE))
  const offset = parseCursor(opts.cursor)
  const where = and(targetWhere(opts.target), isNull(comments.parentId), visibleWhere(opts.viewer))

  const [rows, [countRow]] = await Promise.all([
    db
      .select(cols)
      .from(comments)
      .where(where)
      .orderBy(...orderFor(opts.sort))
      .limit(limit + 1)
      .offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(comments).where(where),
  ])
  const hasMore = rows.length > limit
  const page = rows.slice(0, limit) as Row[]
  const previews = await replyPreviews(
    db,
    page.map((r) => r.id),
    opts.viewer,
  )
  const e = await enrich(db, [...page, ...[...previews.values()].flat()], opts.viewer)
  return {
    comments: page.map((r) =>
      toView(
        r,
        e,
        (previews.get(r.id) ?? []).map((reply) => toView(reply, e)),
      ),
    ),
    total: Number(countRow?.n ?? 0),
    nextCursor: hasMore ? String(offset + limit) : null,
    sort: opts.sort,
  }
}

/** Every visible reply of a comment, oldest first. */
export const listReplies = async (
  db: Db,
  parentId: number,
  viewer: CommentViewer | null,
): Promise<CommentView[]> => {
  const rows = (await db
    .select(cols)
    .from(comments)
    .where(and(eq(comments.parentId, parentId), visibleWhere(viewer)))
    .orderBy(asc(comments.createdAt), asc(comments.id))
    .limit(500)) as Row[]
  const e = await enrich(db, rows, viewer)
  return rows.map((r) => toView(r, e))
}

/** One comment as the viewer sees it (own pending ones included), or null. */
export const getCommentView = async (
  db: Db,
  id: number,
  viewer: CommentViewer | null,
): Promise<CommentView | null> => {
  const [row] = (await db
    .select(cols)
    .from(comments)
    .where(and(eq(comments.id, id), visibleWhere(viewer)))
    .limit(1)) as Row[]
  if (!row) return null
  const e = await enrich(db, [row], viewer)
  return toView(row, e)
}

/** Raw row for mutations (author checks, edit window); no visibility filter. */
export const getCommentRow = async (db: Db, id: number) => {
  const [row] = await db.select(cols).from(comments).where(eq(comments.id, id)).limit(1)
  return (row as Row | undefined) ?? null
}

export const isStaffUser = isStaff
