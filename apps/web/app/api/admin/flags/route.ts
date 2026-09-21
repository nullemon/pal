import { featureFlags, getDb } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { flagSchema } from '@/components/admin/schemas-system'
import { audit } from '@/components/admin/server/audit'
import { purgeSettings } from '@/components/admin/server/cache'
import { ok, parseJson, withPermission } from '@/lib/auth'

/** PUT /api/admin/flags — upsert one flag; DELETE { key } removes it. */
export const PUT = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, flagSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const [before] = await db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.key, parsed.data.key))
    .limit(1)
  const now = new Date()
  await db
    .insert(featureFlags)
    .values({ ...parsed.data, updatedAt: now })
    .onConflictDoUpdate({
      target: featureFlags.key,
      set: {
        enabled: parsed.data.enabled,
        percentage: parsed.data.percentage,
        description: parsed.data.description,
        updatedAt: now,
        deletedAt: null,
      },
    })
  purgeSettings()
  await audit({
    actorId: user.id,
    action: 'settings.flag',
    targetType: 'feature_flag',
    before: before
      ? { key: before.key, enabled: before.enabled, percentage: before.percentage }
      : null,
    after: parsed.data,
  })
  return ok(parsed.data)
})

export const DELETE = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, z.object({ key: z.string().min(1) }))
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const [row] = await db
    .update(featureFlags)
    .set({ deletedAt: new Date() })
    .where(and(eq(featureFlags.key, parsed.data.key), isNull(featureFlags.deletedAt)))
    .returning()
  purgeSettings()
  await audit({
    actorId: user.id,
    action: 'settings.flag.delete',
    targetType: 'feature_flag',
    before: row ?? null,
  })
  return ok({ key: parsed.data.key })
})
