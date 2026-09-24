import { apiKeys, getDb, users } from '@palscans/db'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/components/admin/server/audit'
import { fail, ok, parseJson, withPermission } from '@/lib/auth'
import { mintApiKey } from '@/lib/auth/api-keys'

/**
 * Admin → System → Remote: issue, list and revoke API keys.
 *
 * `settings.write`, the same gate as the rest of System. Issuing a key is handing out an
 * account's permissions, so it belongs with the screens that configure the site rather than
 * the ones that edit content.
 */

/** A key acts as an account, so creating one names that account. */
const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  userId: z.number().int().positive(),
  /** Days until it stops working; omitted means it does not expire on its own. */
  expiresInDays: z.number().int().min(1).max(3650).optional(),
})

export const GET = withPermission('settings.write', async () => {
  const db = await getDb()
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      userId: apiKeys.userId,
      username: users.username,
      email: users.email,
      role: users.role,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .leftJoin(users, eq(users.id, apiKeys.userId))
    .orderBy(desc(apiKeys.createdAt))
    .limit(100)
  return ok({ keys: rows })
})

export const POST = withPermission('settings.write', async (request, _ctx, actor) => {
  const parsed = await parseJson(request, createSchema)
  if (!parsed.ok) return parsed.response

  const db = await getDb()
  const [target] = await db
    .select({ id: users.id, role: users.role, username: users.username })
    .from(users)
    .where(eq(users.id, parsed.data.userId))
    .limit(1)
  if (!target) return fail(400, 'validation')

  const minted = mintApiKey()
  const expiresAt = parsed.data.expiresInDays
    ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000)
    : null
  const [created] = await db
    .insert(apiKeys)
    .values({
      name: parsed.data.name,
      prefix: minted.prefix,
      secretHash: minted.secretHash,
      userId: target.id,
      createdBy: actor.id,
      expiresAt,
    })
    .returning({ id: apiKeys.id, createdAt: apiKeys.createdAt })
  if (!created) return fail(500, 'server_error')

  await audit({
    actorId: actor.id,
    action: 'api_key.create',
    targetType: 'api_key',
    targetId: created.id,
    // The prefix, never the token: this row is rendered in the audit viewer.
    after: { name: parsed.data.name, prefix: minted.prefix, actsAs: target.id, role: target.role },
  })

  // The only time the plaintext exists. Nothing stores it and it cannot be shown again.
  return ok({
    id: created.id,
    name: parsed.data.name,
    prefix: minted.prefix,
    token: minted.token,
    actsAs: { id: target.id, username: target.username, role: target.role },
    expiresAt,
    createdAt: created.createdAt,
  })
})

const revokeSchema = z.object({ id: z.number().int().positive() })

/** Revoked, not deleted: a key named in the audit log has to stay nameable. */
export const DELETE = withPermission('settings.write', async (request, _ctx, actor) => {
  const parsed = await parseJson(request, revokeSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(apiKeys.id, parsed.data.id))
    .returning({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix })
  if (!row) return fail(404, 'not_found')
  await audit({
    actorId: actor.id,
    action: 'api_key.revoke',
    targetType: 'api_key',
    targetId: row.id,
    after: { name: row.name, prefix: row.prefix },
  })
  return ok({ id: row.id })
})
