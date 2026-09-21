import { audit } from '@/components/admin/server/audit'
import { ok, parseJson, withPermission } from '@/lib/auth'
import { createInvite, createInviteSchema, listInvites } from '@/lib/auth/invites'

const serialise = (row: Awaited<ReturnType<typeof createInvite>>) => ({
  id: row.id,
  code: row.code,
  maxUses: row.maxUses,
  uses: row.uses,
  note: row.note,
  expiresAt: row.expiresAt?.toISOString() ?? null,
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  revokedAt: row.revokedAt?.toISOString() ?? null,
})

/** GET /api/admin/access/invites — the code list behind Admin → System → Access. */
export const GET = withPermission('settings.write', async () =>
  ok({ invites: (await listInvites()).map(serialise) }),
)

/** POST /api/admin/access/invites — generate one code (single- or multi-use, with expiry). */
export const POST = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, createInviteSchema)
  if (!parsed.ok) return parsed.response
  const row = await createInvite(parsed.data, user.id)
  await audit({
    actorId: user.id,
    action: 'invite.create',
    targetType: 'invite_code',
    targetId: row.id,
    after: { code: row.code, maxUses: row.maxUses, expiresAt: parsed.data.expiresAt },
  })
  return ok({ invite: serialise(row) })
})
