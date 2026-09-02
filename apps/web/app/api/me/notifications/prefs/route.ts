import { getDb, notificationPrefs } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { ok, parseJson, requireUser } from '@/lib/auth'
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KINDS,
  notificationPrefsSchema,
} from '@/lib/auth/schemas'

/** GET /api/me/notifications/prefs — the kind × channel matrix; PUT {prefs} — replace it. */
export const GET = requireUser(async (_request, _ctx, user) => {
  const db = await getDb()
  const rows = await db
    .select()
    .from(notificationPrefs)
    .where(eq(notificationPrefs.userId, user.id))
  const prefs = NOTIFICATION_KINDS.flatMap((kind) =>
    NOTIFICATION_CHANNELS.map((channel) => ({
      kind,
      channel,
      enabled: rows.find((r) => r.kind === kind && r.channel === channel)?.enabled ?? true,
    })),
  )
  return ok({ prefs })
})

export const PUT = requireUser(async (request, _ctx, user) => {
  const parsed = await parseJson(request, notificationPrefsSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  await db.transaction(async (tx) => {
    for (const p of parsed.data.prefs) {
      await tx
        .insert(notificationPrefs)
        .values({ userId: user.id, kind: p.kind, channel: p.channel, enabled: p.enabled })
        .onConflictDoUpdate({
          target: [notificationPrefs.userId, notificationPrefs.kind, notificationPrefs.channel],
          set: { enabled: p.enabled },
        })
    }
  })
  return ok({ saved: true })
})
