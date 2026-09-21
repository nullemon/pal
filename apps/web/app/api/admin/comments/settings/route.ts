import { commentSettings, getDb, settings } from '@palscans/db'
import { sql } from 'drizzle-orm'
import { audit } from '@/components/admin/server/audit'
import { purgeSettings } from '@/components/admin/server/cache'
import { ok, parseJson, withPermission } from '@/lib/auth'
import {
  commentSettingsSchema,
  loadCommentSettings,
  resetCommentSettingsCache,
} from '@/lib/comments/settings'

/** PUT /api/admin/comments/settings — docs/14 §3 settings, one row per key in comment_settings. */
export const PUT = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, commentSettingsSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const before = await loadCommentSettings(db, 0)
  const now = new Date()
  for (const [key, value] of Object.entries(parsed.data)) {
    await db
      .insert(commentSettings)
      .values({ key, value: value === null ? sql`'null'::jsonb` : value, updatedAt: now })
      .onConflictDoUpdate({
        target: commentSettings.key,
        set: { value: value === null ? sql`'null'::jsonb` : value, updatedAt: now },
      })
  }
  await db
    .insert(settings)
    .values({ key: 'comments', value: parsed.data, updatedBy: user.id, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: parsed.data, updatedBy: user.id, updatedAt: now },
    })
  resetCommentSettingsCache()
  purgeSettings()
  await audit({
    actorId: user.id,
    action: 'settings.comments',
    targetType: 'settings',
    before,
    after: parsed.data,
  })
  return ok(parsed.data)
})
