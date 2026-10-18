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
    })
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(and(eq(chapters.id, chapterId), isNull(chapters.deletedAt)))
    .limit(1)
  if (!row) return null
  return resolveCredit({
    settings: await creditSettings(database),
    series: { backgroundKey: row.backgroundKey, overlayId: row.overlayId },
    chapterNote: row.note,
    chapterCreatedAt: row.createdAt,
  })
}
