import { eq } from 'drizzle-orm'
import type { Db } from '../client.js'
import { appearanceSettings, seoSettings, settings } from '../schema/index.js'

/** Read one key from the generic `settings` table, typed by the caller. */
export const getSetting = async <T>(db: Db, key: string, fallback: T): Promise<T> => {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1)
  return row ? (row.value as T) : fallback
}

export const getSeoSetting = async <T>(db: Db, key: string, fallback: T): Promise<T> => {
  const [row] = await db
    .select({ value: seoSettings.value })
    .from(seoSettings)
    .where(eq(seoSettings.key, key))
    .limit(1)
  return row ? (row.value as T) : fallback
}

/** The published appearance document and its resolved CSS token block (docs/15). */
export const publishedAppearance = async (db: Db) => {
  const [row] = await db
    .select()
    .from(appearanceSettings)
    .where(eq(appearanceSettings.status, 'published'))
    .limit(1)
  return row ?? null
}
