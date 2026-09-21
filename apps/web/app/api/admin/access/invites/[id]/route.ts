import { audit } from '@/components/admin/server/audit'
import { idParam } from '@/components/admin/server/params'
import { notFound, ok, withPermission } from '@/lib/auth'
import { revokeInvite } from '@/lib/auth/invites'

/** DELETE /api/admin/access/invites/:id — revoke (never delete: the use count is evidence). */
export const DELETE = withPermission<{ id: string }>(
  'settings.write',
  async (_request, ctx, user) => {
    const id = idParam.safeParse((await ctx.params).id)
    if (!id.success) return notFound()
    const row = await revokeInvite(id.data)
    if (!row) return notFound()
    await audit({
      actorId: user.id,
      action: 'invite.revoke',
      targetType: 'invite_code',
      targetId: row.id,
      before: { code: row.code, uses: row.uses, revokedAt: null },
      after: { code: row.code, uses: row.uses, revokedAt: row.revokedAt?.toISOString() ?? null },
    })
    return ok({ id: row.id, revokedAt: row.revokedAt?.toISOString() ?? null })
  },
)
