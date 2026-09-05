import { plainText } from '@palscans/core/comments'
import { isCommentBody } from '@palscans/core/comments/schema'
import {
  auditLog,
  type CommentBodyJson,
  chapters,
  comments,
  communityImages,
  getDb,
  linkAllowlist,
  reports,
  series,
  users,
  wordFilters,
} from '@palscans/db'
import { and, count, desc, eq, exists, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { PAGE_SIZE } from './params'

export type ModerationTab = 'pending' | 'reported' | 'flagged' | 'all'

export interface QueueComment {
  id: number
  body: CommentBodyJson
  text: string
  status: string
  isPinned: boolean
  locked: boolean
  hasLink: boolean
  automodScore: number
  automodRules: string[]
  createdAt: string
  user: {
    id: number
    username: string | null
    role: string
    createdAt: string
    commentCount: number
    priorActions: number
    commentBannedUntil: string | null
  }
  series: { id: number; title: string; slug: string } | null
  chapter: { id: number; number: number } | null
  parent: { id: number; username: string | null; text: string } | null
  reports: number
}

/** Plain text of a stored body (the JSON column is typed loosely; guard before walking it). */
export const textOf = (body: unknown): string => (isCommentBody(body) ? plainText(body) : '')

export const loadModerationQueue = async (tab: ModerationTab, page: number) => {
  const db = await getDb()
  const parent = alias(comments, 'parent')
  const parentUser = alias(users, 'parent_user')
  const reportedSub = db
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.targetType, 'comment'),
        eq(reports.targetId, comments.id),
        eq(reports.status, 'open'),
      ),
    )
  const where = and(
    isNull(comments.deletedAt),
    tab === 'pending'
      ? eq(comments.status, 'pending')
      : tab === 'reported'
        ? exists(reportedSub)
        : tab === 'flagged'
          ? or(gt(comments.automodScore, 0), eq(comments.status, 'shadow'))
          : undefined,
  )
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: comments.id,
        body: comments.body,
        status: comments.status,
        isPinned: comments.isPinned,
        locked: comments.locked,
        hasLink: comments.hasLink,
        automodScore: comments.automodScore,
        automodRules: comments.automodRules,
        createdAt: comments.createdAt,
        userId: users.id,
        username: users.username,
        role: users.role,
        userCreatedAt: users.createdAt,
        commentBannedUntil: users.commentBannedUntil,
        seriesId: series.id,
        seriesTitle: series.title,
        seriesSlug: series.slug,
        chapterId: chapters.id,
        chapterNumber: chapters.number,
        parentId: parent.id,
        parentBody: parent.body,
        parentUsername: parentUser.username,
        reportCount: sql<number>`(select count(*)::int from ${reports} where ${reports.targetType} = 'comment' and ${reports.targetId} = ${comments.id} and ${reports.status} = 'open')`,
        commentCount: sql<number>`(select count(*)::int from comments c2 where c2.user_id = ${users.id} and c2.deleted_at is null)`,
        priorActions: sql<number>`(select count(*)::int from ${auditLog} where ${auditLog.targetType} = 'user' and ${auditLog.targetId} = ${users.id})`,
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .leftJoin(series, eq(series.id, comments.seriesId))
      .leftJoin(chapters, eq(chapters.id, comments.chapterId))
      .leftJoin(parent, eq(parent.id, comments.parentId))
      .leftJoin(parentUser, eq(parentUser.id, parent.userId))
      .where(where)
      .orderBy(desc(comments.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(comments).where(where),
  ])
  const items: QueueComment[] = rows.map((r) => ({
    id: r.id,
    body: r.body,
    text: textOf(r.body),
    status: r.status,
    isPinned: r.isPinned,
    locked: r.locked,
    hasLink: r.hasLink,
    automodScore: r.automodScore,
    automodRules: r.automodRules,
    createdAt: r.createdAt.toISOString(),
    user: {
      id: r.userId,
      username: r.username,
      role: r.role,
      createdAt: r.userCreatedAt.toISOString(),
      commentCount: Number(r.commentCount),
      priorActions: Number(r.priorActions),
      commentBannedUntil: r.commentBannedUntil?.toISOString() ?? null,
    },
    series: r.seriesId
      ? { id: r.seriesId, title: r.seriesTitle ?? '', slug: r.seriesSlug ?? '' }
      : null,
    chapter: r.chapterId ? { id: r.chapterId, number: r.chapterNumber ?? 0 } : null,
    parent: r.parentId
      ? {
          id: r.parentId,
          username: r.parentUsername ?? null,
          text: textOf(r.parentBody).slice(0, 140),
        }
      : null,
    reports: Number(r.reportCount),
  }))
  const n = total?.n ?? 0
  return { items, total: n, pages: Math.max(1, Math.ceil(n / PAGE_SIZE)) }
}

export const loadModerationCounts = async () => {
  const db = await getDb()
  const [[pending], [reported], [flagged]] = await Promise.all([
    db
      .select({ n: count() })
      .from(comments)
      .where(and(isNull(comments.deletedAt), eq(comments.status, 'pending'))),
    db
      .select({ n: count() })
      .from(reports)
      .where(and(eq(reports.targetType, 'comment'), eq(reports.status, 'open'))),
    db
      .select({ n: count() })
      .from(comments)
      .where(
        and(
          isNull(comments.deletedAt),
          or(gt(comments.automodScore, 0), eq(comments.status, 'shadow')),
        ),
      ),
  ])
  return { pending: pending?.n ?? 0, reported: reported?.n ?? 0, flagged: flagged?.n ?? 0 }
}

export const loadFiltersAndAllowlist = async () => {
  const db = await getDb()
  const [filters, allow] = await Promise.all([
    db
      .select({
        id: wordFilters.id,
        pattern: wordFilters.pattern,
        isRegex: wordFilters.isRegex,
        action: wordFilters.action,
        replacement: wordFilters.replacement,
      })
      .from(wordFilters)
      .where(isNull(wordFilters.deletedAt))
      .orderBy(desc(wordFilters.id)),
    db
      .select({ domain: linkAllowlist.domain })
      .from(linkAllowlist)
      .where(isNull(linkAllowlist.deletedAt))
      .orderBy(linkAllowlist.domain),
  ])
  return { filters, allowlist: allow.map((a) => a.domain) }
}

export const loadCommunityImages = async (status: 'pending' | 'approved') => {
  const db = await getDb()
  return db
    .select({
      id: communityImages.id,
      key: communityImages.key,
      width: communityImages.width,
      height: communityImages.height,
      tags: communityImages.tags,
      status: communityImages.status,
      isCollection: communityImages.isCollection,
      uploadedBy: users.username,
      createdAt: communityImages.createdAt,
    })
    .from(communityImages)
    .leftJoin(users, eq(users.id, communityImages.uploadedBy))
    .where(eq(communityImages.status, status))
    .orderBy(desc(communityImages.createdAt))
    .limit(120)
}

export const resolveReportsFor = async (
  targetType: string,
  targetIds: number[],
  handledBy: number,
  status: 'actioned' | 'rejected',
) => {
  if (targetIds.length === 0) return
  const db = await getDb()
  await db
    .update(reports)
    .set({ status, handledBy, handledAt: new Date() })
    .where(
      and(
        eq(reports.targetType, targetType),
        inArray(reports.targetId, targetIds),
        eq(reports.status, 'open'),
      ),
    )
}
