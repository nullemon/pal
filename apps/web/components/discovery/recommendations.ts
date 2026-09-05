'use server'

import { getDb, recommendedSeries, series } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import { z } from 'zod'
import { getSessionUser } from '@/lib/auth/session'
import { ensureConfig } from '@/lib/config/install'
import { toSummary } from './queries'
import type { SeriesSummary } from './types'

/**
 * "More like this" for the end-of-chapter card (docs/12 §10 "recommended series … internal
 * linking is structural"). The reader has just finished a chapter — the highest-intent
 * moment on the site — so the suggestions have to be worth the slot: same genres, best
 * rated, and nothing this reader has already read or bookmarked.
 *
 * It is a server action rather than data passed down from the chapter page for two reasons:
 * the card sits below every page of the chapter, so most sessions never scroll to it and
 * should not pay for the query; and the answer is per-reader, which would make the chapter
 * page itself uncacheable. The viewer comes from the session cookie — the client never sends
 * a user id, so one reader can never ask for another's history.
 */

/** Six fits one row at desktop width and two thumb-widths of scroll on a phone. */
const LIMIT = 6

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/i)

/** Published series id for a slug, or null. Cached: it is the same for everyone. */
const publishedSeriesId = unstable_cache(
  async (slug: string): Promise<number | null> => {
    await ensureConfig()
    const db = await getDb()
    const [row] = await db
      .select({ id: series.id })
      .from(series)
      .where(and(eq(series.slug, slug), eq(series.state, 'published'), isNull(series.deletedAt)))
      .limit(1)
    return row?.id ?? null
  },
  ['recs', 'series-id'],
  { revalidate: 300, tags: ['catalog'] },
)

/** The anonymous rail: no history to subtract, so it is the same for every signed-out reader. */
const anonymousRecommendations = unstable_cache(
  async (seriesId: number): Promise<SeriesSummary[]> => {
    await ensureConfig()
    const db = await getDb()
    const rows = await recommendedSeries(db, seriesId, {
      limit: LIMIT,
      fallbackToPopular: true,
    })
    return rows.map(toSummary)
  },
  ['recs', 'anonymous'],
  { revalidate: 600, tags: ['catalog'] },
)

/**
 * Recommendations for whoever is asking. Returns `[]` for an unknown slug rather than
 * throwing: this decorates a card, it must never be able to break the reader.
 */
export async function readerRecommendations(slug: string): Promise<SeriesSummary[]> {
  const parsed = slugSchema.safeParse(slug)
  if (!parsed.success) return []
  try {
    const seriesId = await publishedSeriesId(parsed.data)
    if (seriesId === null) return []
    const user = await getSessionUser()
    if (!user) return anonymousRecommendations(seriesId)

    await ensureConfig()
    const db = await getDb()
    const rows = await recommendedSeries(db, seriesId, {
      limit: LIMIT,
      excludeReadBy: user.id,
      excludeBookmarkedBy: user.id,
      fallbackToPopular: true,
    })
    return rows.map(toSummary)
  } catch {
    return []
  }
}
