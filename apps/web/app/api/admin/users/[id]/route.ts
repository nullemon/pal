import { can } from '@palscans/core'
import { messages } from '@palscans/core/messages'
import { bans, entitlements, getDb, users } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { userActionSchema } from '@/components/admin/schemas-users'
import { audit } from '@/components/admin/server/audit'
import { idParam } from '@/components/admin/server/params'
import {
  fail,
  invalidateSessionCache,
  notFound,
  ok,
  parseJson,
  revokeAllSessions,
  revokeSession,
  withPermission,
} from '@/lib/auth'
import { sendVerification } from '@/lib/auth/flows'

/**
 * POST /api/admin/users/:id — role change (typed confirmation, never self), entitlement
 * grants with expiry, session revocation, comment-ban, ban, force logout, resend verification
 * (docs/04 "Users"). Every branch is audited against the user.
 */
export const POST = withPermission<{ id: string }>('user.read', async (request, ctx, actor) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJson(request, userActionSchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const db = await getDb()
  const [target] = await db.select().from(users).where(eq(users.id, id.data)).limit(1)
  if (!target) return notFound()
  const needs =
    body.action === 'role'
      ? 'user.role'
      : body.action === 'grant' || body.action === 'revoke'
        ? 'entitlement.grant'
        : body.action === 'ban' || body.action === 'unban' || body.action === 'comment_ban'
          ? 'user.ban'
          : 'user.update'
  if (!can(actor, needs)) return fail(403, 'forbidden', messages.errors.forbidden)
  if (target.id === actor.id && body.action !== 'resend_verification')
    return fail(400, 'self', messages.admin.forbiddenSelf)
  const now = new Date()
  let before: unknown = null
  let after: unknown = null

  switch (body.action) {
    case 'role': {
      if (body.confirm !== (target.username ?? target.email))
        return fail(400, 'confirm', messages.errors.validation)
      before = { role: target.role }
      await db.update(users).set({ role: body.role, updatedAt: now }).where(eq(users.id, target.id))
      await invalidateSessionCache(target.id)
      after = { role: body.role }
      break
    }
    case 'grant': {
      const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null
      await db
        .insert(entitlements)
        .values({ userId: target.id, feature: body.feature, source: 'grant', expiresAt })
        .onConflictDoUpdate({
          target: [entitlements.userId, entitlements.feature],
          set: { source: 'grant', expiresAt },
        })
      after = { feature: body.feature, expiresAt: body.expiresAt }
      break
    }
    case 'revoke':
      await db
        .delete(entitlements)
        .where(and(eq(entitlements.userId, target.id), eq(entitlements.feature, body.feature)))
      before = { feature: body.feature }
      break
    case 'revoke_session':
      await revokeSession(body.sessionId)
      after = { sessionId: body.sessionId }
      break
    case 'force_logout':
      after = { revoked: await revokeAllSessions(target.id) }
      break
    case 'comment_ban': {
      const until = body.until ? new Date(body.until) : null
      before = { commentBannedUntil: target.commentBannedUntil }
      await db
        .update(users)
        .set({ commentBannedUntil: until, updatedAt: now })
        .where(eq(users.id, target.id))
      after = { commentBannedUntil: until }
      break
    }
    case 'ban':
      await db.insert(bans).values({
        kind: 'user',
        value: String(target.id),
        userId: target.id,
        reason: body.reason ?? null,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        createdBy: actor.id,
      })
      await revokeAllSessions(target.id)
      after = { banned: true, reason: body.reason ?? null, expiresAt: body.expiresAt ?? null }
      break
    case 'unban':
      await db
        .update(bans)
        .set({ revokedAt: now })
        .where(and(eq(bans.userId, target.id), isNull(bans.revokedAt)))
      after = { banned: false }
      break
    case 'resend_verification':
      if (target.emailVerifiedAt) return fail(400, 'already_verified')
      await sendVerification(target.id, target.email)
      after = { sent: true }
      break
  }
  await audit({
    actorId: actor.id,
    action: `user.${body.action}`,
    targetType: 'user',
    targetId: target.id,
    before,
    after,
    request,
  })
  return ok({ id: target.id, action: body.action, after })
})
