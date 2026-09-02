/**
 * Bayesian rating (docs/02-data-model.md): (rating_sum + C*m) / (rating_count + C)
 * with m = site mean and C ≈ 20, so a single 10/10 does not top the chart.
 */
export const BAYESIAN_C = 20

export interface RatingInput {
  ratingSum: number
  ratingCount: number
}

export const bayesianRating = (
  input: RatingInput,
  siteMean: number,
  c: number = BAYESIAN_C,
): number => {
  const { ratingSum, ratingCount } = input
  if (ratingCount + c <= 0) return 0
  return (ratingSum + c * siteMean) / (ratingCount + c)
}

/** Display rating, rounded to one decimal, 0 when unrated. */
export const displayRating = (input: RatingInput): number =>
  input.ratingCount > 0 ? Math.round((input.ratingSum / input.ratingCount) * 10) / 10 : 0

/** Mean of all ratings site-wide, from totals. */
export const siteMean = (totalSum: number, totalCount: number, fallback = 7.5): number =>
  totalCount > 0 ? totalSum / totalCount : fallback

/** Sort a list by Bayesian rating, descending, ties by rating count. */
export const rankByRating = <T extends RatingInput>(items: readonly T[], mean: number): T[] =>
  [...items].sort(
    (a, b) => bayesianRating(b, mean) - bayesianRating(a, mean) || b.ratingCount - a.ratingCount,
  )

// --- popularity windows -----------------------------------------------------------------

export const POPULARITY_WINDOWS = ['weekly', 'monthly', 'all'] as const
export type PopularityWindow = (typeof POPULARITY_WINDOWS)[number]

export const POPULARITY_WINDOW_DAYS: Record<PopularityWindow, number | null> = {
  weekly: 7,
  monthly: 30,
  all: null,
}

export const isPopularityWindow = (v: unknown): v is PopularityWindow =>
  typeof v === 'string' && (POPULARITY_WINDOWS as readonly string[]).includes(v)

const DAY_MS = 86_400_000

/**
 * Start date (UTC, midnight) for a window, or null for all-time.
 * Weekly at 2026-01-10 → 2026-01-03 (the last 7 daily buckets inclusive of today).
 */
export const windowStart = (window: PopularityWindow, now: Date = new Date()): Date | null => {
  const days = POPULARITY_WINDOW_DAYS[window]
  if (days === null) return null
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return new Date(midnight - (days - 1) * DAY_MS)
}

/** `YYYY-MM-DD` for a UTC date, the format used by the `bucket` date columns. */
export const bucketKey = (d: Date): string => d.toISOString().slice(0, 10)

/**
 * Comment "Best" sort: score with a time decay (docs/14 §1).
 * Half-life in hours; a 2-day old comment with score 10 ranks like a fresh one with ~2.5.
 */
export const decayedScore = (
  score: number,
  createdAt: Date,
  now: Date = new Date(),
  halfLifeHours = 24,
): number => {
  const ageHours = Math.max(0, (now.getTime() - createdAt.getTime()) / 3_600_000)
  return score * 0.5 ** (ageHours / halfLifeHours)
}
