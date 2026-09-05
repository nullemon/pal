import { describe, expect, it } from 'vitest'
import {
  addDays,
  buildGrid,
  dayKey,
  fromLocalInput,
  parseAnchor,
  rangeLabel,
  shiftAnchor,
  startOfWeek,
  toLocalInput,
  withTimeOf,
} from './grid'

/**
 * The calendar is only useful if a chapter lands on the day the operator dropped it on, at
 * the hour it was already going out. These cover the two places that goes wrong: week/month
 * boundaries, and the time-of-day carried through a move.
 */

const at = (iso: string) => new Date(iso)

describe('buildGrid', () => {
  it('draws a Monday-first week around the anchor', () => {
    const grid = buildGrid('week', at('2026-10-08T15:00:00')) // a Thursday
    expect(grid.days).toHaveLength(7)
    expect(dayKey(grid.start)).toBe('2026-10-05')
    expect(dayKey(grid.days[6] as Date)).toBe('2026-10-11')
    expect(dayKey(grid.end)).toBe('2026-10-12')
  })

  it('draws whole weeks for a month, spilling into its neighbours', () => {
    const grid = buildGrid('month', at('2026-10-08T00:00:00'))
    expect(grid.days.length % 7).toBe(0)
    expect(dayKey(grid.start)).toBe('2026-09-28') // Monday before 1 October
    expect(dayKey(grid.days[grid.days.length - 1] as Date)).toBe('2026-11-01')
  })

  it('covers a month that starts on a Monday and one that needs six rows', () => {
    const june = buildGrid('month', at('2026-06-15T00:00:00')) // 1 June 2026 is a Monday
    expect(dayKey(june.start)).toBe('2026-06-01')
    expect(june.days).toHaveLength(35) // whole weeks, so it runs to 5 July
    const august = buildGrid('month', at('2026-08-10T00:00:00')) // 1 Aug 2026 is a Saturday
    expect(august.days).toHaveLength(42)
    expect(dayKey(august.start)).toBe('2026-07-27')
    expect(dayKey(august.days[41] as Date)).toBe('2026-09-06')
  })

  it('always contains the anchor day', () => {
    for (const iso of ['2026-01-01', '2026-02-28', '2026-05-31', '2026-12-31']) {
      const anchor = at(`${iso}T09:00:00`)
      for (const view of ['week', 'month'] as const)
        expect(buildGrid(view, anchor).days.map(dayKey)).toContain(iso)
    }
  })
})

describe('anchors', () => {
  it('reads the query param and falls back to today', () => {
    expect(dayKey(parseAnchor('2026-10-08'))).toBe('2026-10-08')
    expect(dayKey(parseAnchor(undefined, at('2026-03-04T22:00:00')))).toBe('2026-03-04')
    expect(dayKey(parseAnchor('nonsense', at('2026-03-04T22:00:00')))).toBe('2026-03-04')
  })

  it('steps by a week or a whole month', () => {
    expect(dayKey(shiftAnchor('week', at('2026-10-08T00:00:00'), 1))).toBe('2026-10-15')
    expect(dayKey(shiftAnchor('week', at('2026-10-08T00:00:00'), -1))).toBe('2026-10-01')
    expect(dayKey(shiftAnchor('month', at('2026-10-08T00:00:00'), 1))).toBe('2026-11-01')
    expect(dayKey(shiftAnchor('month', at('2026-01-31T00:00:00'), 1))).toBe('2026-02-01')
  })

  it('starts weeks on Monday whatever day it is given', () => {
    expect(dayKey(startOfWeek(at('2026-10-11T23:59:00')))).toBe('2026-10-05') // Sunday
    expect(dayKey(startOfWeek(at('2026-10-05T00:00:00')))).toBe('2026-10-05') // Monday
  })
})

describe('withTimeOf', () => {
  it('keeps the release hour when a chapter moves to another day', () => {
    const moved = withTimeOf(at('2026-10-10T00:00:00'), at('2026-10-08T18:30:00'))
    expect(toLocalInput(moved)).toBe('2026-10-10T18:30')
  })

  it('gives an undated chapter a sensible hour rather than midnight', () => {
    expect(toLocalInput(withTimeOf(at('2026-10-10T00:00:00'), null))).toBe('2026-10-10T12:00')
    expect(toLocalInput(withTimeOf(at('2026-10-10T00:00:00'), null, 9))).toBe('2026-10-10T09:00')
  })
})

describe('local input round-trip', () => {
  it('reads back exactly what it wrote, in local time', () => {
    const date = at('2026-10-08T18:30:00')
    expect(fromLocalInput(toLocalInput(date))?.getTime()).toBe(date.getTime())
    expect(fromLocalInput('')).toBeNull()
    expect(fromLocalInput('2026-13-40T99:99')?.getTime()).not.toBe(date.getTime())
  })
})

describe('rangeLabel', () => {
  it('names the period the way a heading should', () => {
    expect(rangeLabel(buildGrid('month', at('2026-10-08T00:00:00')), 'en-GB')).toBe('October 2026')
    expect(rangeLabel(buildGrid('week', at('2026-10-08T00:00:00')), 'en-GB')).toBe(
      '5 – 11 Oct 2026',
    )
    expect(rangeLabel(buildGrid('week', at('2026-10-01T00:00:00')), 'en-GB')).toBe(
      `${new Date(2026, 8, 28).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – 4 Oct 2026`,
    )
  })
})

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(dayKey(addDays(at('2026-12-31T00:00:00'), 1))).toBe('2027-01-01')
    expect(dayKey(addDays(at('2026-03-01T00:00:00'), -1))).toBe('2026-02-28')
  })
})

/**
 * Appearance → Formatting → Week starts on (docs/15). The default stays Monday — every test
 * above depends on it — and Sunday shifts both the week grid and the month's leading spill.
 */
describe('week starts on', () => {
  it('defaults to Monday, so nothing above changes', () => {
    expect(dayKey(startOfWeek(at('2026-10-08T15:00:00')))).toBe('2026-10-05')
  })

  it('starts a week on Sunday when asked', () => {
    const grid = buildGrid('week', at('2026-10-08T15:00:00'), 'sunday')
    expect(dayKey(grid.start)).toBe('2026-10-04')
    expect(dayKey(grid.days[6] as Date)).toBe('2026-10-10')
    expect(grid.days).toHaveLength(7)
  })

  it('keeps a Sunday-first month grid whole weeks', () => {
    const grid = buildGrid('month', at('2026-10-08T00:00:00'), 'sunday')
    expect(grid.days.length % 7).toBe(0)
    expect(dayKey(grid.start)).toBe('2026-09-27') // Sunday before 1 October
    expect(
      grid.days.every((d, i) => i === 0 || d.getTime() > (grid.days[i - 1] as Date).getTime()),
    ).toBe(true)
  })

  it('lands on the anchor day itself when the anchor is the first day of the week', () => {
    expect(dayKey(startOfWeek(at('2026-10-04T12:00:00'), 'sunday'))).toBe('2026-10-04')
    expect(dayKey(startOfWeek(at('2026-10-05T12:00:00'), 'monday'))).toBe('2026-10-05')
  })
})
