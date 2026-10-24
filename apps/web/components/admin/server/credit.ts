import 'server-only'
import {
  type CreditSettings,
  creditSettingsSchema,
  DEFAULT_CREDIT_SETTINGS,
  type ResolvedCredit,
  resolveCredit,
} from '@palscans/core/credit'
import { chapters, type Db, getDb, getSetting, putSetting, series } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'

/**
 * The credit page's settings, and resolving one chapter's card (docs/03).
 *
 * The rules themselves live in `@palscans/core/credit`, pure and tested. This is the half
 * that talks to the database: reading the settings row, writing it back, and gathering the
 * series and chapter overrides the renderer needs.
 */

export const CREDIT_SETTING_KEY = 'credit_page'

/**
 * Parsed through the schema on the way out, never trusted as stored.
 *
 * The row is JSON written by an older build or by hand, so a field that has since changed
 * shape would otherwise reach the renderer as whatever it happens to be. `.catch` on the
 * parse means a malformed row degrades to the defaults — which have the feature *off* — in
 * preference to taking the chapter page down with it.
 */
export const creditSettings = async (db?: Db): Promise<CreditSettings> => {
  const database = db ?? (await getDb())
  const raw = await getSetting<unknown>(database, CREDIT_SETTING_KEY, null).catch(() => null)
  const parsed = creditSettingsSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : DEFAULT_CREDIT_SETTINGS
}

export const saveCreditSettings = async (
  input: CreditSettings,
  userId: number,
  db?: Db,
): Promise<CreditSettings> => {
  const database = db ?? (await getDb())
  const value = creditSettingsSchema.parse(input)
  await putSetting(database, CREDIT_SETTING_KEY, value, userId)
  return value
}

/**
 * What this chapter's credit page shows, or null when it should not have one.
 *
 * One query for the two overrides rather than two: the renderer is on the read path of every
 * chapter page, and a second round trip for a column that travels with the first is a cost
 * paid on every reader.
 */
export const creditForChapter = async (
  chapterId: number,
  db?: Db,
): Promise<ResolvedCredit | null> => {
  const database = db ?? (await getDb())
  const [row] = await database
    .select({
      note: chapters.creditNote,
      // For the "new chapters only" cutoff — see `enabledAt` in @palscans/core/credit.
      createdAt: chapters.createdAt,
      backgroundKey: series.creditBackgroundKey,
      overlayId: series.creditOverlayId,
      // Work that is not ours: no credit page, whatever the site settings say.
      seriesDisabled: series.creditDisabled,
      chapterDisabled: chapters.creditDisabled,
    })
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(and(eq(chapters.id, chapterId), isNull(chapters.deletedAt)))
    .limit(1)
  if (!row) return null
  return resolveCredit({
    settings: await creditSettings(database),
    series: {
      backgroundKey: row.backgroundKey,
      overlayId: row.overlayId,
      disabled: row.seriesDisabled,
    },
    chapterNote: row.note,
    chapterDisabled: row.chapterDisabled,
    chapterCreatedAt: row.createdAt,
  })
}

/** Series the credit screen lists, with whether each one is excluded. */
export const creditSeriesList = async (
  db?: Db,
): Promise<Array<{ id: number; title: string; disabled: boolean }>> => {
  const database = db ?? (await getDb())
  const rows = await database
    .select({ id: series.id, title: series.title, disabled: series.creditDisabled })
    .from(series)
    .where(isNull(series.deletedAt))
    .orderBy(series.title)
    .limit(2000)
  return rows.map((r) => ({ ...r, disabled: r.disabled === true }))
}

/** Turn the credit page off (or back on) for one series. */
export const setSeriesCreditDisabled = async (
  seriesId: number,
  disabled: boolean,
  db?: Db,
): Promise<boolean> => {
  const database = db ?? (await getDb())
  const rows = await database
    .update(series)
    .set({ creditDisabled: disabled, updatedAt: new Date() })
    .where(and(eq(series.id, seriesId), isNull(series.deletedAt)))
    .returning({ id: series.id })
  return rows.length > 0
}
