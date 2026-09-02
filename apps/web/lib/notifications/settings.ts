import { getSetting, settings } from '@palscans/db'
import { coerceNotificationSettings, type NotificationSettings, SETTINGS_KEY } from './schema'
import type { NotifyDb } from './types'

/**
 * Server-side reads and writes for `settings.notifications` (docs/17 §D), stored the way
 * `ads`, `layouts` and `comments` are. Credentials never live here: VAPID and the bot token
 * come from the environment, so a database dump carries no secrets. The document's shape
 * lives in `./schema` so client components can share it.
 */
export * from './schema'

/**
 * Read the stored document, filling every hole with the default. A half-written row from an
 * older shape must never take a screen down, so parsing failures fall back rather than throw.
 */
export const readNotificationSettings = async (db: NotifyDb): Promise<NotificationSettings> => {
  const raw = await getSetting<unknown>(db, SETTINGS_KEY, {})
  return coerceNotificationSettings(raw)
}

/** Write the document back (the caller writes the `audit_log` row). */
export const writeNotificationSettings = async (
  db: NotifyDb,
  value: NotificationSettings,
  updatedBy: number,
): Promise<void> => {
  const now = new Date()
  await db
    .insert(settings)
    .values({ key: SETTINGS_KEY, value, updatedBy, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedBy, updatedAt: now },
    })
}
