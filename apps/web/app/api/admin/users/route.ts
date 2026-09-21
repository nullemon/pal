import { can, canActOn } from '@palscans/core'
import { messages } from '@palscans/core/messages'
import { entitlements, getDb, users } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { createUserSchema } from '@/app/admin/users/schemas'
import { audit } from '@/components/admin/server/audit'
import { fail, forbidden, ok, parseJson, withPermission } from '@/lib/auth'
import { hashPassword } from '@/lib/auth/password'
import { usernameAvailability } from '@/lib/auth/users'

/**
 * POST /api/admin/users — docs/17 §C "Admin → Users → new": create an account by hand with
 * a role, a verified flag and initial entitlement grants. Creating anything above a reader
 * needs `user.role`; perks need `entitlement.grant`; staff targets go through `canActOn`, so
 * a moderator cannot mint an admin.
 */
export const POST = withPermission('user.update', async (request, _ctx, actor) => {
  const parsed = await parseJson(request, createUserSchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  if (body.role !== 'user' && !can(actor, 'user.role')) return forbidden()
  if (!canActOn(actor, body.role)) return forbidden()
  if (body.entitlements.length > 0 && !can(actor, 'entitlement.grant')) return forbidden()

  const db = await getDb()
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, body.email))
    .limit(1)
  if (existing) return fail(409, 'account_exists', messages.auth.accountExists)
  if (body.username) {
    const availability = await usernameAvailability(body.username)
    if (availability === 'taken') return fail(409, 'username_taken', messages.auth.usernameTaken)
    if (availability === 'reserved')
      return fail(409, 'username_reserved', messages.authPage.usernameReserved)
  }

  const now = new Date()
  const [created] = await db
    .insert(users)
    .values({
      email: body.email,
      username: body.username ?? null,
      passwordHash: body.password ? await hashPassword(body.password) : null,
      role: body.role,
      emailVerifiedAt: body.verified ? now : null,
    })
    .returning({ id: users.id })
  if (!created) return fail(500, 'server_error', messages.errors.serverError)

  if (body.entitlements.length > 0) {
    await db
      .insert(entitlements)
      .values(
        body.entitlements.map((feature) => ({
          userId: created.id,
          feature,
          source: 'grant' as const,
          expiresAt: null,
        })),
      )
      .onConflictDoNothing({ target: [entitlements.userId, entitlements.feature] })
  }

  await audit({
    actorId: actor.id,
    action: 'user.create',
    targetType: 'user',
    targetId: created.id,
    after: {
      email: body.email,
      username: body.username ?? null,
      role: body.role,
      verified: body.verified,
      hasPassword: !!body.password,
      entitlements: body.entitlements,
    },
  })
  return ok({ id: created.id })
})
