import { describe, expect, it } from 'vitest'
import {
  BAYESIAN_C,
  bayesianRating,
  bucketKey,
  decayedScore,
  displayRating,
  rankByRating,
  siteMean,
  windowStart,
} from '../ranking.js'

describe('bayesianRating', () => {
  it('uses C=20 and the site mean as the prior', () => {
    expect(BAYESIAN_C).toBe(20)
    // a single 10/10 with a 7.5 site mean sits near the mean
    const one = bayesianRating({ ratingSum: 10, ratingCount: 1 }, 7.5)
    expect(one).toBeCloseTo((10 + 20 * 7.5) / 21, 6)
    expect(one).toBeLessThan(8)
    // 12,481 ratings averaging 9.6 stay at ~9.6
    const many = bayesianRating({ ratingSum: 9.6 * 12481, ratingCount: 12481 }, 7.5)
    expect(many).toBeGreaterThan(9.59)
    expect(bayesianRating({ ratingSum: 0, ratingCount: 0 }, 7.5)).toBe(7.5)
  })
  it('ranks a well-rated title over a single 10/10', () => {
    const a = { id: 'single', ratingSum: 10, ratingCount: 1 }
    const b = { id: 'popular', ratingSum: 940, ratingCount: 100 }
    expect(rankByRating([a, b], 7.5).map((x) => x.id)).toEqual(['popular', 'single'])
  })
  it('display rating rounds to one decimal', () => {
    expect(displayRating({ ratingSum: 119818, ratingCount: 12481 })).toBe(9.6)
    expect(displayRating({ ratingSum: 0, ratingCount: 0 })).toBe(0)
    expect(siteMean(0, 0)).toBe(7.5)
    expect(siteMean(90, 10)).toBe(9)
  })
})

describe('popularity windows', () => {
  const now = new Date('2026-01-10T15:30:00Z')
  it('weekly covers the last 7 daily buckets', () => {
    expect(bucketKey(windowStart('weekly', now) as Date)).toBe('2026-01-04')
    expect(bucketKey(windowStart('monthly', now) as Date)).toBe('2025-12-12')
    expect(windowStart('all', now)).toBeNull()
  })
  it('decays comment scores by half-life', () => {
    const created = new Date(now.getTime() - 24 * 3_600_000)
    expect(decayedScore(10, created, now)).toBeCloseTo(5, 6)
    expect(decayedScore(10, now, now)).toBe(10)
  })
})
