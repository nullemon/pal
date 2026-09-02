import {
  auditLog,
  bans,
  chapters,
  comments,
  entitlements,
  escapeLike,
  getDb,
  series,
  sessions,
  subscriptions,
  users,
} from '@palscans/db'
import { and, count, desc, eq, gt, ilike, isNull, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { textOf } from './moderation'
import { PAGE_SIZE } from './params'

export const loadUserList = async (q: string | undefined, page: number) => {
  const db = await getDb()
  const numeric = q && /^\d+$/.test(q) ? Number(q) : null
  const where = and(
    isNull(users.deletedAt),
    q
      ? or(
          ilike(users.email, `%${escapeLike(q)}%`),
          ilike(users.username, `%${escapeLike(q)}%`),
          numeric ? eq(users.id, numeric) : undefined,
        )
      : undefined,
  )
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        role: users.role,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        emailVerifiedAt: users.emailVerifiedAt,
        commentBannedUntil: users.commentBannedUntil,
        banned: sql<boolean>`exists(select 1 from ${bans} where ${bans.kind} = 'user' and ${bans.value} = ${users.id}::text and ${bans.revokedAt} is null and (${bans.expiresAt} is null or ${bans.expiresAt} > now()))`,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(users).where(where),
  ])
  return { rows, total: total?.n ?? 0, pages: Math.max(1, Math.ceil((total?.n ?? 0) / PAGE_SIZE)) }
}

export const loadUserDetail = async (id: number) => {
  const db = await getDb()
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  if (!row) return null
  const actor = alias(users, 'actor')
  const now = new Date()
  const [ents, sess, [sub], recentComments, uploads, trail, activeBans] = await Promise.all([
    db
      .select({
        feature: entitlements.feature,
        source: entitlements.source,
        expiresAt: entitlements.expiresAt,
      })
      .from(entitlements)
      .where(eq(entitlements.userId, id)),
    db
      .select({
        id: sessions.id,
        userAgent: sessions.userAgent,
        createdAt: sessions.createdAt,
        lastSeenAt: sessions.lastSeenAt,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, id), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
      .orderBy(desc(sessions.lastSeenAt)),
    db
      .select({
        planId: subscriptions.planId,
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      })
      .from(subscriptions)
      .where(eq(subscriptions.userId, id))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1),
    db
      .select({
        id: comments.id,
        body: comments.body,
        status: comments.status,
        createdAt: comments.createdAt,
        seriesTitle: series.title,
        seriesSlug: series.slug,
      })
      .from(comments)
      .leftJoin(series, eq(series.id, comments.seriesId))
      .where(eq(comments.userId, id))
      .orderBy(desc(comments.createdAt))
      .limit(10),
    db
      .select({
        id: chapters.id,
        number: chapters.number,
        state: chapters.state,
        seriesId: chapters.seriesId,
        seriesTitle: series.title,
        createdAt: chapters.createdAt,
      })
      .from(chapters)
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .where(eq(chapters.uploadedBy, id))
      .orderBy(desc(chapters.createdAt))
      .limit(10),
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        actor: actor.username,
        createdAt: auditLog.createdAt,
        after: auditLog.after,
      })
      .from(auditLog)
      .leftJoin(actor, eq(actor.id, auditLog.actorId))
      .where(and(eq(auditLog.targetType, 'user'), eq(auditLog.targetId, id)))
      .orderBy(desc(auditLog.createdAt))
      .limit(20),
    db
      .select({
        id: bans.id,
        kind: bans.kind,
        reason: bans.reason,
        expiresAt: bans.expiresAt,
        createdAt: bans.createdAt,
      })
      .from(bans)
      .where(
        and(
          eq(bans.userId, id),
          isNull(bans.revokedAt),
          or(isNull(bans.expiresAt), gt(bans.expiresAt, now)),
        ),
      ),
  ])
  return {
    user: row,
    entitlements: ents,
    sessions: sess,
    subscription: sub ?? null,
    comments: recentComments.map((c) => ({ ...c, text: textOf(c.body).slice(0, 200) })),
    uploads,
    trail,
    bans: activeBans,
  }
}
