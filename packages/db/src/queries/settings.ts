import { and, eq, type SQL, sql } from 'drizzle-orm'
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

/**
 * Write one key to the generic `settings` table.
 *
 * Both the web app and the worker checkpoint documents here (the watermark re-apply run is
 * one), so the upsert lives next to the reader rather than being copied into each caller
 * with its own subtly different conflict clause.
 */
export const putSetting = async (
  db: Db,
  key: string,
  value: unknown,
  updatedBy: number | null = null,
  now: Date = new Date(),
): Promise<void> => {
  await db
    .insert(settings)
    .values({ key, value, updatedBy, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy, updatedAt: now } })
}

/**
 * Shallow-merge `patch` into an existing JSON settings document, in one statement.
 *
 * The difference from {@link putSetting} is who else is writing. A document two processes
 * both own — the watermark re-apply run, where the worker checkpoints its cursor while the
 * panel may be setting `cancelRequested` — cannot be written whole from either side without
 * the risk of throwing away the other's field between a read and a write. `jsonb ||` merges
 * server-side, so each writer only ever touches its own keys.
 *
 * `guard` is an extra predicate (typically "this is still the document I think it is").
 * Returns false when nothing matched, which is the caller's signal that the document is gone
 * or has been replaced.
 */
export const mergeSetting = async (
  db: Db,
  key: string,
  patch: Record<string, unknown>,
  guard?: SQL,
  updatedBy?: number | null,
  now: Date = new Date(),
): Promise<boolean> => {
  const rows = await db
    .update(settings)
    .set({
      value: sql`coalesce(${settings.value}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: now,
      ...(updatedBy === undefined ? {} : { updatedBy }),
    })
    .where(guard ? and(eq(settings.key, key), guard) : eq(settings.key, key))
    .returning({ key: settings.key })
  return rows.length > 0
}

export const getSeoSetting = async <T>(db: Db, key: string, fallback: T): Promise<T> => {
  const [row] = await db
    .select({ value: seoSettings.value })
    .from(seoSettings)
    .where(eq(seoSettings.key, key))
    .limit(1)
  return row ? (row.value as T) : fallback
}

/**
 * The published theme document and its resolved CSS token block (docs/15).
 *
 * Scoped to `theme` since 9033: the table now carries one published row per Appearance
 * screen, and `<head>` wants that one. Without the predicate this would return whichever of
 * the four published rows the planner reached first.
 */
export const publishedAppearance = async (db: Db) => {
  const [row] = await db
    .select()
    .from(appearanceSettings)
    .where(and(eq(appearanceSettings.status, 'published'), eq(appearanceSettings.scope, 'theme')))
    .limit(1)
  return row ?? null
}
