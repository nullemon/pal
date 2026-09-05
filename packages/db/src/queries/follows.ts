import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Db } from '../client.js'
import { bookmarks, series, seriesFollows } from '../schema/index.js'
import { publishedSeries } from './_shared.js'

/**
 * Series follows (docs/17 §D). A follow is the subscription — "tell me when this updates" —
 * and it is deliberately *not* the bookmark, which is the shelf.
 *
 * `series_follows` is an override layer: a bookmark with no row here still counts as a
 * follow on `all`, which is what every bookmarker had before the table existed. Every read
 * below therefore has to answer for both, so the merge rule lives here once instead of in
 * each caller. The channel semantics of a `mode` live in
 * `apps/web/lib/notifications/follows.ts`, next to the preference matrix it is ANDed with.
 */

/**
 * Mirrors the `series_follows_mode_check` constraint. The reader-facing copy of this list
 * is `FOLLOW_MODES` in `apps/web/lib/notifications/schema.ts` — client-safe, so account
 * screens can render the picker without pulling a database driver into the browser bundle.
 * The two are kept in step by the call sites that pass one into the other.
 */
export const SERIES_FOLLOW_MODES = ['all', 'push', 'in_app', 'digest', 'off'] as const
export type FollowModeName = (typeof SERIES_FOLLOW_MODES)[number]

export const DEFAULT_FOLLOW_MODE: FollowModeName = 'all'

export const isFollowModeName = (v: unknown): v is FollowModeName =>
  typeof v === 'string' && (SERIES_FOLLOW_MODES as readonly string[]).includes(v)

/** Where a follow came from: a row the reader wrote, or the bookmark it is inherited from. */
export type FollowSource = 'follow' | 'bookmark'

export interface FollowState {
  mode: FollowModeName
  source: FollowSource
  /** The reader also has this series on a shelf (and which one). */
  bookmarkStatus: string | null
}

export interface FollowedSeries extends FollowState {
  seriesId: number
  slug: string
  title: string
  type: string
  status: string
  coverKey: string | null
  coverColor: string | null
  chapterCount: number
  lastChapterAt: Date | null
  followedAt: Date
}

/** One reader's relationship with one series: the explicit row if any, else the bookmark. */
export const followState = async (
  db: Db,
  userId: number,
  seriesId: number,
): Promise<FollowState | null> => {
  const [row] = await db
    .select({
      mode: seriesFollows.mode,
      bookmarkStatus: bookmarks.status,
    })
    .from(seriesFollows)
    .leftJoin(
      bookmarks,
      and(
        eq(bookmarks.userId, seriesFollows.userId),
        eq(bookmarks.seriesId, seriesFollows.seriesId),
      ),
    )
    .where(and(eq(seriesFollows.userId, userId), eq(seriesFollows.seriesId, seriesId)))
    .limit(1)
  if (row)
    return {
      mode: isFollowModeName(row.mode) ? row.mode : DEFAULT_FOLLOW_MODE,
      source: 'follow',
      bookmarkStatus: row.bookmarkStatus ?? null,
    }
  const [mark] = await db
    .select({ status: bookmarks.status })
    .from(bookmarks)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.seriesId, seriesId)))
    .limit(1)
  if (!mark) return null
  return { mode: DEFAULT_FOLLOW_MODE, source: 'bookmark', bookmarkStatus: mark.status }
}

/** The same answer for a page full of series, in one round trip each. */
export const followStates = async (
  db: Db,
  userId: number,
  seriesIds: readonly number[],
): Promise<Map<number, FollowState>> => {
  const out = new Map<number, FollowState>()
  if (seriesIds.length === 0) return out
  const ids = [...new Set(seriesIds)]
  const [follows, marks] = await Promise.all([
    db
      .select({ seriesId: seriesFollows.seriesId, mode: seriesFollows.mode })
      .from(seriesFollows)
      .where(and(eq(seriesFollows.userId, userId), inArray(seriesFollows.seriesId, ids))),
    db
      .select({ seriesId: bookmarks.seriesId, status: bookmarks.status })
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, userId), inArray(bookmarks.seriesId, ids))),
  ])
  const shelf = new Map(marks.map((m) => [m.seriesId, m.status]))
  for (const [seriesId, status] of shelf)
    out.set(seriesId, { mode: DEFAULT_FOLLOW_MODE, source: 'bookmark', bookmarkStatus: status })
  for (const f of follows)
    out.set(f.seriesId, {
      mode: isFollowModeName(f.mode) ? f.mode : DEFAULT_FOLLOW_MODE,
      source: 'follow',
      bookmarkStatus: shelf.get(f.seriesId) ?? null,
    })
  return out
}

/**
 * Everything a reader follows, for `/me/notifications` — the rows they wrote *and* the
 * bookmarks they never touched, because both are being notified and the screen would lie if
 * it showed only half. Explicit follows sort first (they are the ones with an opinion),
 * then by the most recent chapter.
 */
export const followedSeries = async (
  db: Db,
  userId: number,
  limit = 200,
): Promise<FollowedSeries[]> => {
  const rows = await db
    .select({
      seriesId: series.id,
      slug: series.slug,
      title: series.title,
      type: series.type,
      status: series.status,
      coverKey: series.coverKey,
      coverColor: series.coverColor,
      chapterCount: series.chapterCount,
      lastChapterAt: series.lastChapterAt,
      mode: seriesFollows.mode,
      bookmarkStatus: bookmarks.status,
      followedAt: sql<Date>`coalesce(${seriesFollows.createdAt}, ${bookmarks.createdAt})`,
    })
    .from(series)
    .leftJoin(
      seriesFollows,
      and(eq(seriesFollows.seriesId, series.id), eq(seriesFollows.userId, userId)),
    )
    .leftJoin(bookmarks, and(eq(bookmarks.seriesId, series.id), eq(bookmarks.userId, userId)))
    .where(
      and(
        publishedSeries(),
        sql`(${seriesFollows.userId} IS NOT NULL OR ${bookmarks.userId} IS NOT NULL)`,
      ),
    )
    .orderBy(
      sql`case when ${seriesFollows.userId} is null then 1 else 0 end`,
      desc(series.lastChapterAt),
      series.title,
    )
    .limit(limit)
  return rows.map((r) => ({
    seriesId: r.seriesId,
    slug: r.slug,
    title: r.title,
    type: r.type,
    status: r.status,
    coverKey: r.coverKey,
    coverColor: r.coverColor,
    chapterCount: r.chapterCount,
    lastChapterAt: r.lastChapterAt,
    mode: isFollowModeName(r.mode) ? r.mode : DEFAULT_FOLLOW_MODE,
    source: r.mode === null ? 'bookmark' : 'follow',
    bookmarkStatus: r.bookmarkStatus ?? null,
    followedAt: r.followedAt ?? new Date(0),
  }))
}

/** Write (or change) a follow. Idempotent — the follow button is a toggle people double-tap. */
export const setFollowMode = async (
  db: Db,
  userId: number,
  seriesId: number,
  mode: FollowModeName,
): Promise<boolean> => {
  const [live] = await db
    .select({ id: series.id })
    .from(series)
    .where(and(eq(series.id, seriesId), publishedSeries()))
    .limit(1)
  if (!live) return false
  const now = new Date()
  await db
    .insert(seriesFollows)
    .values({ userId, seriesId, mode, updatedAt: now })
    .onConflictDoUpdate({
      target: [seriesFollows.userId, seriesFollows.seriesId],
      set: { mode, updatedAt: now },
    })
  return true
}

/**
 * Stop following. With the series still on a shelf this has to *write* `off` rather than
 * delete: the bookmark would otherwise be read as an implicit follow again and the reader
 * would be re-subscribed by the very act of unsubscribing. With no bookmark behind it the
 * row is only a toggle, and is deleted.
 */
export const unfollowSeries = async (
  db: Db,
  userId: number,
  seriesId: number,
): Promise<'muted' | 'removed'> => {
  const [mark] = await db
    .select({ seriesId: bookmarks.seriesId })
    .from(bookmarks)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.seriesId, seriesId)))
    .limit(1)
  if (mark) {
    await setFollowMode(db, userId, seriesId, 'off')
    return 'muted'
  }
  await db
    .delete(seriesFollows)
    .where(and(eq(seriesFollows.userId, userId), eq(seriesFollows.seriesId, seriesId)))
  return 'removed'
}

/** How many accounts a series notifies — explicit follows plus the bookmarks behind them. */
export const followerCount = async (db: Db, seriesId: number): Promise<number> => {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bookmarks)
    .leftJoin(
      seriesFollows,
      and(
        eq(seriesFollows.seriesId, bookmarks.seriesId),
        eq(seriesFollows.userId, bookmarks.userId),
      ),
    )
    .where(and(eq(bookmarks.seriesId, seriesId), isNull(seriesFollows.userId)))
  const implicit = Number(row?.n ?? 0)
  const [explicit] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(seriesFollows)
    .where(and(eq(seriesFollows.seriesId, seriesId), sql`${seriesFollows.mode} <> 'off'`))
  return implicit + Number(explicit?.n ?? 0)
}
