import { describe, expect, it } from 'vitest'
import { AGE_RAMP, duration, durationParts, severityFor, sparkPath, stack } from './format'

/** The arithmetic behind `/admin/moderation` (app/admin/moderation/format.ts). */

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('duration', () => {
  it('drops to the precision the queue is judged at', () => {
    expect(duration(0)).toBe('under a minute')
    expect(duration(45_000)).toBe('under a minute')
    expect(duration(3 * MIN)).toBe('3m')
    expect(duration(HOUR)).toBe('1h')
    expect(duration(4 * HOUR + 12 * MIN)).toBe('4h 12m')
    expect(duration(2 * DAY + 4 * HOUR)).toBe('2d 4h')
    expect(duration(21 * DAY)).toBe('21d')
  })

  it('never rounds a late item down to nothing', () => {
    expect(duration(61_000)).toBe('1m')
    expect(duration(-5)).toBe('under a minute')
  })
})

describe('durationParts', () => {
  it('gives the hero figure one number and one unit', () => {
    expect(durationParts(21 * DAY)).toEqual({ value: '21', unit: 'days' })
    expect(durationParts(DAY)).toEqual({ value: '1', unit: 'day' })
    expect(durationParts(5 * HOUR)).toEqual({ value: '5', unit: 'hours' })
    expect(durationParts(HOUR)).toEqual({ value: '1', unit: 'hour' })
    expect(durationParts(90_000)).toEqual({ value: '1', unit: 'minute' })
    // A brand-new item is "1 minute", never "0".
    expect(durationParts(0)).toEqual({ value: '1', unit: 'minute' })
  })
})

describe('severityFor', () => {
  it('separates fine, late and inexcusable rather than flagging everything red', () => {
    expect(severityFor(2 * HOUR, 24)).toBe('ok')
    expect(severityFor(25 * HOUR, 24)).toBe('warn')
    expect(severityFor(8 * DAY, 24)).toBe('danger')
    // A DMCA notice gets 48 hours, so 30 is still on time for it and late for a report.
    expect(severityFor(30 * HOUR, 48)).toBe('ok')
    expect(severityFor(30 * HOUR, 24)).toBe('warn')
  })
})

describe('stack', () => {
  const bands = [
    { key: 'fresh', count: 6 },
    { key: 'aging', count: 3 },
    { key: 'stale', count: 1 },
  ]

  it('turns counts into widths that add up to the whole bar', () => {
    const segments = stack(bands, (b) => b.count)
    expect(segments).toHaveLength(3)
    expect(segments.reduce((t, s) => t + s.percent, 0)).toBeCloseTo(100)
    expect(segments[0]?.percent).toBeCloseTo(60)
  })

  it('drops empty bands rather than drawing a hairline nobody can read', () => {
    const segments = stack([...bands, { key: 'empty', count: 0 }], (b) => b.count)
    expect(segments.map((s) => s.item.key)).toEqual(['fresh', 'aging', 'stale'])
    expect(stack(bands, () => 0)).toEqual([])
  })
})

describe('the age ramp', () => {
  it('is three monotone steps of one hue, darkest last', () => {
    expect(AGE_RAMP).toEqual([60, 80, 100])
    for (let i = 1; i < AGE_RAMP.length; i++)
      expect(AGE_RAMP[i] as number).toBeGreaterThan(AGE_RAMP[i - 1] as number)
  })
})

describe('sparkPath', () => {
  it('spans the box and starts with a move', () => {
    const d = sparkPath([0, 5, 2], 90, 18)
    expect(d.startsWith('M0.0,')).toBe(true)
    expect(d.split('L')).toHaveLength(3)
    expect(d).toContain('90.0,')
  })

  it('is empty for no data and flat for one value', () => {
    expect(sparkPath([], 90, 18)).toBe('')
    expect(sparkPath([3], 90, 18)).toBe('M0.0,1.0')
  })
})
