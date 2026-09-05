import { can, canActOn } from '@palscans/core'
import { messages } from '@palscans/core/messages'
import { bans, getDb, users } from '@palscans/db'
import { and, inArray, isNull } from 'drizzle-orm'
import { BULK_CONFIRM_WORD, bulkUsersSchema } from '@/app/admin/users/schemas'
import { audit } from '@/components/admin/server/audit'
import { fail, forbidden, ok, parseJson, revokeAllSessions, withPermission } from '@/lib/auth'

/**
 * POST /api/admin/users/bulk — docs/17 §C bulk actions from the users list. The rules of the
 * single-user screen apply to every row: never yourself, `canActOn` for staff targets, the
 * permission the action needs, a typed confirmation, and one audit row per account touched
 * plus a summary row for the batch. Accounts the actor may not touch are skipped, not
 * refused, so one protected row does not throw away the rest of a selection.
 */
export const POST = withPermission('user.read', async (request, _ctx, actor) => {
  const parsed = await parseJson(request, bulkUsersSchema)
  if (!parsed.ok) return parsed.response
  const { ids, action } = parsed.data
  if (parsed.data.confirm.trim() !== BULK_CONFIRM_WORD)
    return fail(400, 'confirm', messages.errors.validation)

  const needs =
    action.kind === 'role'
      ? 'user.role'
      : action.kind === 'force_logout'
        ? 'user.update'
        : 'user.ban'
  if (!can(actor, needs)) return forbidden()

  const db = await getDb()
  const targets = await db
    .select({ id: users.id, role: users.role, commentBannedUntil: users.commentBannedUntil })
    .from(users)
    .where(and(inArray(users.id, ids), isNull(users.deletedAt)))
  const allowed = targets.filter((t) => t.id !== actor.id && canActOn(actor, t.role))
  // The filter above asks "may I act on these accounts as they are now?" — a role change
  // must also ask "may I hand out the role I am about to write?", or a moderator granted
  // `user.role` promotes a reader they control to admin. Same gap the single-user route had.
  if (action.kind === 'role' && !canActOn(actor, action.role)) return forbidden()
  const skipped = ids.length - allowed.length
  if (allowed.length === 0) return ok({ updated: 0, skipped, ids: [] })

  const now = new Date()
  const targetIds = allowed.map((t) => t.id)

  switch (action.kind) {
    case 'role':
      await db
        .update(users)
        .set({ role: action.role, updatedAt: now })
        .where(inArray(users.id, targetIds))
      // docs/07: a role change rotates every session of the account.
      for (const id of targetIds) await revokeAllSessions(id)
      break
    case 'ban':
      await db.insert(bans).values(
        allowed.map((t) => ({
          kind: 'user',
          value: String(t.id),
          userId: t.id,
          reason: action.reason ?? null,
          expiresAt: null,
          createdBy: actor.id,
        })),
      )
      for (const id of targetIds) await revokeAllSessions(id)
      break
    case 'unban':
      await db
        .update(bans)
        .set({ revokedAt: now })
        .where(and(inArray(bans.userId, targetIds), isNull(bans.revokedAt)))
      break
    case 'comment_ban': {
      const until = new Date(now.getTime() + action.days * 86_400_000)
      await db
        .update(users)
        .set({ commentBannedUntil: until, updatedAt: now })
        .where(inArray(users.id, targetIds))
      break
    }
    case 'force_logout':
      for (const id of targetIds) await revokeAllSessions(id)
      break
  }

  for (const target of allowed) {
    await audit({
      actorId: actor.id,
      action: `user.${action.kind}`,
      targetType: 'user',
      targetId: target.id,
      before:
        action.kind === 'role'
          ? { role: target.role }
          : action.kind === 'comment_ban'
            ? { commentBannedUntil: target.commentBannedUntil?.toISOString() ?? null }
            : null,
      after: { ...action, bulk: true },
      request,
    })
  }
  await audit({
    actorId: actor.id,
    action: 'user.bulk',
    targetType: 'user',
    after: { action: action.kind, requested: ids.length, updated: allowed.length, skipped },
    request,
  })
  return ok({ updated: allowed.length, skipped, ids: targetIds })
})
