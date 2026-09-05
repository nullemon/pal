import { describe, expect, it } from 'vitest'
import {
  axisScale,
  type ChartPoint,
  compactCount,
  groupDigits,
  labelIndexes,
  monthDay,
  nearestIndex,
  plotPoints,
  summarise,
} from '@/components/admin/analytics/chart'

/** The arithmetic behind the analytics chart (components/admin/analytics/chart.ts). */

const day = (bucket: string, views: number): ChartPoint => ({ bucket, views })

describe('axisScale', () => {
  it('puts round numbers on the gridlines', () => {
    expect(axisScale(15)).toEqual({ max: 20, ticks: [0, 5, 10, 15, 20] })
    expect(axisScale(870)).toEqual({ max: 1000, ticks: [0, 250, 500, 750, 1000] })
  })

  it('never crops the data', () => {
    for (const max of [1, 7, 23, 99, 101, 4_999, 81_654, 1_234_567]) {
      const scale = axisScale(max)
      expect(scale.max).toBeGreaterThanOrEqual(max)
      expect(scale.ticks[0]).toBe(0)
      expect(scale.ticks.at(-1)).toBe(scale.max)
    }
  })

  it('takes the tighter of four or five intervals rather than wasting the plot', () => {
    // Four intervals would have to round 120k up to 200k; five land on 125k.
    expect(axisScale(120_000).max).toBe(125_000)
    expect(axisScale(120_000).ticks).toHaveLength(6)
  })

  it('keeps whole views on the gridlines, even for an empty window', () => {
    // Nothing recorded: 0, 1, 2, 3, 4 — never 0.25 of a view.
    expect(axisScale(0)).toEqual({ max: 4, ticks: [0, 1, 2, 3, 4] })
    expect(axisScale(3).ticks.every(Number.isInteger)).toBe(true)
  })
})

describe('labelIndexes', () => {
  it('labels every point when there is room', () => {
    expect(labelIndexes(7)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('always labels the last point — today is the one the reader looks for', () => {
    for (const n of [7, 30, 90]) {
      const labels = labelIndexes(n)
      expect(labels.at(-1)).toBe(n - 1)
      expect(labels.length).toBeLessThanOrEqual(7)
      expect(labels).toEqual([...labels].sort((a, b) => a - b))
      expect(new Set(labels).size).toBe(labels.length)
    }
  })

  it('spaces the labels evenly', () => {
    const labels = labelIndexes(30)
    const gaps = labels.slice(1).map((v, i) => v - (labels[i] as number))
    expect(new Set(gaps).size).toBe(1)
  })

  it('handles an empty window', () => {
    expect(labelIndexes(0)).toEqual([])
  })
})

describe('number and date formatting', () => {
  it('groups digits without asking the runtime for a locale', () => {
    expect(groupDigits(0)).toBe('0')
    expect(groupDigits(999)).toBe('999')
    expect(groupDigits(1_000)).toBe('1,000')
    expect(groupDigits(2_449_634)).toBe('2,449,634')
  })

  it('compacts a big number the way the rest of the panel does', () => {
    expect(compactCount(0)).toBe('0')
    expect(compactCount(999)).toBe('999')
    expect(compactCount(1_000)).toBe('1K')
    expect(compactCount(81_300)).toBe('81.3K')
    expect(compactCount(2_449_634)).toBe('2.4M')
    expect(compactCount(1_500_000_000)).toBe('1.5B')
  })

  it('shortens a bucket to its month and day', () => {
    expect(monthDay('2026-09-04')).toBe('09-04')
  })
})

describe('summarise', () => {
  it('totals, averages over every day and finds the peak', () => {
    const points = [day('2026-09-01', 10), day('2026-09-02', 0), day('2026-09-03', 26)]
    expect(summarise(points)).toEqual({
      total: 36,
      average: 12, // 36 / 3 — the quiet day still counts as a day
      peak: { bucket: '2026-09-03', views: 26 },
    })
  })

  it('says nothing rather than NaN for an empty window', () => {
    expect(summarise([])).toEqual({ total: 0, average: 0, peak: null })
  })
})

describe('plot geometry', () => {
  const box = { width: 500, height: 200, padding: { top: 10, right: 20, bottom: 20, left: 80 } }

  it('spreads the points across the plot and puts the biggest at the top', () => {
    const laid = plotPoints([day('a', 0), day('b', 50), day('c', 100)], 100, box)
    expect(laid.map((p) => p.x)).toEqual([80, 280, 480])
    expect(laid[0]?.y).toBe(180) // zero sits on the baseline (height - bottom padding)
    expect(laid[2]?.y).toBe(10) // the max sits on the top padding
    expect(laid[1]?.y).toBe(95)
  })

  it('does not divide by zero on a single point or an all-zero window', () => {
    expect(plotPoints([day('a', 5)], 5, box)[0]).toMatchObject({ x: 80, y: 10 })
    expect(plotPoints([day('a', 0), day('b', 0)], 0, box).every((p) => p.y === 180)).toBe(true)
  })

  it('snaps to the nearest point, so the reader aims at a day and not at a 2px line', () => {
    const xs = [80, 280, 480]
    expect(nearestIndex(xs, 0)).toBe(0)
    expect(nearestIndex(xs, 179)).toBe(0)
    expect(nearestIndex(xs, 181)).toBe(1)
    expect(nearestIndex(xs, 10_000)).toBe(2)
    expect(nearestIndex([], 5)).toBe(0)
  })
})
