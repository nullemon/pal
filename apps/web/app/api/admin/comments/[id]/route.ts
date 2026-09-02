import { domainOf, isCommentBody, linkHrefs } from '@palscans/core/comments'
import { bans, comments, getDb, linkAllowlist, notifications, users } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { commentActionSchema } from '@/components/admin/schemas-moderation'
import { audit } from '@/components/admin/server/audit'
import { resolveReportsFor } from '@/components/admin/server/moderation'
import { idParam } from '@/components/admin/server/params'
import { fail, notFound, ok, parseJson, revokeAllSessions, withPermission } from '@/lib/auth'

/**
 * POST /api/admin/comments/:id — the moderation actions from docs/14 §3. Comment-level
 * actions resolve any open report on the comment; user-level actions are audited against
 * the user so they show on the author card as "prior actions".
 */
export const POST = withPermission<{ id: string }>(
  'comment.moderate',
  async (request, ctx, user) => {
    const id = idParam.safeParse((await ctx.params).id)
    if (!id.success) return notFound()
    const parsed = await parseJson(request, commentActionSchema)
    if (!parsed.ok) return parsed.response
    const body = parsed.data
    const db = await getDb()
    const [c] = await db
      .select()
      .from(comments)
      .where(and(eq(comments.id, id.data), isNull(comments.deletedAt)))
      .limit(1)
    if (!c) return notFound()
    if (c.userId === user.id && ['warn', 'comment_ban', 'shadow_ban', 'ban'].includes(body.action))
      return fail(400, 'self')
    const now = new Date()
    const before = { status: c.status, isPinned: c.isPinned, locked: c.locked }
    let after: Record<string, unknown> = {}
    let targetType = 'comment'
    let targetId: number = c.id

    switch (body.action) {
      case 'approve':
      case 'approve_allowlist': {
        await db.update(comments).set({ status: 'published' }).where(eq(comments.id, c.id))
        const domains =
          body.action === 'approve_allowlist'
            ? [
                ...new Set(
                  (isCommentBody(c.body) ? linkHrefs(c.body) : [])
                    .map(domainOf)
                    .filter((d): d is string => !!d),
                ),
              ]
            : []
        if (domains.length)
          await db
            .insert(linkAllowlist)
            .values(domains.map((domain) => ({ domain, createdBy: user.id })))
            .onConflictDoUpdate({
              target: linkAllowlist.domain,
              set: { createdBy: user.id, createdAt: now, deletedAt: null },
            })
        await resolveReportsFor('comment', [c.id], user.id, 'rejected')
        after = { status: 'published', allowlisted: domains }
        break
      }
      case 'reject':
        await db.update(comments).set({ status: 'rejected' }).where(eq(comments.id, c.id))
        await resolveReportsFor('comment', [c.id], user.id, 'actioned')
        after = { status: 'rejected', reason: body.reason ?? null }
        break
      case 'delete':
        await db
          .update(comments)
          .set({ status: 'removed', deletedAt: now })
          .where(eq(comments.id, c.id))
        await resolveReportsFor('comment', [c.id], user.id, 'actioned')
        after = { status: 'removed', deletedAt: now.toISOString() }
        break
      case 'pin':
        await db.update(comments).set({ isPinned: body.value }).where(eq(comments.id, c.id))
        after = { isPinned: body.value }
        break
      case 'lock':
        await db.update(comments).set({ locked: body.value }).where(eq(comments.id, c.id))
        after = { locked: body.value }
        break
      case 'warn':
        await db.insert(notifications).values({
          userId: c.userId,
          kind: 'system',
          payload: { message: body.message, commentId: c.id },
        })
        targetType = 'user'
        targetId = c.userId
        after = { warned: body.message, commentId: c.id }
        break
      case 'comment_ban': {
        const until = body.days
          ? new Date(now.getTime() + body.days * 86_400_000)
          : new Date('2999-01-01T00:00:00Z')
        await db
          .update(users)
          .set({ commentBannedUntil: until, updatedAt: now })
          .where(eq(users.id, c.userId))
        targetType = 'user'
        targetId = c.userId
        after = { commentBannedUntil: until.toISOString(), days: body.days }
        break
      }
      case 'shadow_ban':
        await db
          .update(comments)
          .set({ status: 'shadow' })
          .where(and(eq(comments.userId, c.userId), eq(comments.status, 'published')))
        await db.insert(bans).values({
          kind: 'shadow',
          value: String(c.userId),
          userId: c.userId,
          reason: `comment ${c.id}`,
          createdBy: user.id,
        })
        targetType = 'user'
        targetId = c.userId
        after = { shadow: true, commentId: c.id }
        break
      case 'ban':
        await db.insert(bans).values({
          kind: 'user',
          value: String(c.userId),
          userId: c.userId,
          reason: body.reason ?? `comment ${c.id}`,
          createdBy: user.id,
        })
        await db
          .update(comments)
          .set({ status: 'removed', deletedAt: now })
          .where(eq(comments.id, c.id))
        await revokeAllSessions(c.userId)
        await resolveReportsFor('comment', [c.id], user.id, 'actioned')
        targetType = 'user'
        targetId = c.userId
        after = { banned: true, reason: body.reason ?? null, commentId: c.id }
        break
    }
    await audit({
      actorId: user.id,
      action: `comment.${body.action}`,
      targetType,
      targetId,
      before,
      after,
      request,
    })
    return ok({ id: c.id, action: body.action, ...after })
  },
)
