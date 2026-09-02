import { getDb, linkAllowlist } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { allowlistSchema } from '@/components/admin/schemas-moderation'
import { audit } from '@/components/admin/server/audit'
import { ok, parseJson, withPermission } from '@/lib/auth'

export const POST = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, allowlistSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  await db
    .insert(linkAllowlist)
    .values({ domain: parsed.data.domain, createdBy: user.id })
    .onConflictDoUpdate({
      target: linkAllowlist.domain,
      set: { createdBy: user.id, createdAt: new Date(), deletedAt: null },
    })
  await audit({
    actorId: user.id,
    action: 'settings.allowlist.add',
    targetType: 'link_allowlist',
    after: parsed.data,
    request,
  })
  return ok(parsed.data)
})

export const DELETE = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, allowlistSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  await db
    .update(linkAllowlist)
    .set({ deletedAt: new Date() })
    .where(eq(linkAllowlist.domain, parsed.data.domain))
  await audit({
    actorId: user.id,
    action: 'settings.allowlist.remove',
    targetType: 'link_allowlist',
    before: parsed.data,
    request,
  })
  return ok(parsed.data)
})
