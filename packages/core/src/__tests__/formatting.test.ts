import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FORMATTING,
  formatChapterLabel,
  formatCount,
  formatIsoDate,
  formatStamp,
  formatTimeOfDay,
  parseFormatting,
  weekStartIndex,
} from '../formatting.js'
import { chapterLabel, compactNumber } from '../time.js'

/**
 * The Formatting document (docs/15 "Formatting"). Two things matter: the defaults have to
 * reproduce what the site rendered before the setting existed, and a stored row has to be
 * coerced field by field so a half-written document never takes a page down.
 */

describe('defaults', () => {
  it('are what the site already did', () => {
    expect(DEFAULT_FORMATTING).toEqual({
      relativeTimes: 'both',
      clock: '24h',
      numbers: 'compact',
      chapterLabel: 'short',
      weekStartsOn: 'monday',
    })
    // "both" is today's <time>: a relative phrase, the date on hover.
    expect(formatCount(81_300)).toBe(compactNumber(81_300))
    expect(formatChapterLabel(301)).toBe(chapterLabel(301))
    expect(formatChapterLabel(301)).toBe('Ch. 301')
    expect(weekStartIndex()).toBe(1)
  })
})

describe('parseFormatting', () => {
  it('answers the defaults for anything unusable', () => {
    for (const raw of [null, undefined, 0, 'x', [], {}, { relativeTimes: 'sideways' }]) {
      expect(parseFormatting(raw)).toEqual(DEFAULT_FORMATTING)
    }
  })

  it('keeps the fields it recognises and defaults the rest', () => {
    expect(parseFormatting({ clock: '12h', numbers: 'nope', weekStartsOn: 'sunday' })).toEqual({
      ...DEFAULT_FORMATTING,
      clock: '12h',
      weekStartsOn: 'sunday',
    })
  })

  it('never throws on a hostile row', () => {
    expect(() =>
      parseFormatting({ clock: { toString: () => '12h' }, chapterLabel: Symbol('x') }),
    ).not.toThrow()
  })
})

describe('numbers', () => {
  it('is 81.3K compact and 81,300 grouped', () => {
    expect(formatCount(81_300, 'compact')).toBe('81.3K')
    expect(formatCount(81_300, 'grouped')).toBe('81,300')
    expect(formatCount(999, 'grouped')).toBe('999')
    expect(formatCount(1_000, 'grouped')).toBe('1,000')
    expect(formatCount(1_234_567, 'grouped')).toBe('1,234,567')
    expect(formatCount(-4_200, 'grouped')).toBe('-4,200')
  })

  it('renders a non-number as zero rather than NaN', () => {
    expect(formatCount(Number.NaN, 'grouped')).toBe('0')
    expect(formatCount(Number.POSITIVE_INFINITY, 'compact')).toBe('0')
  })
})

describe('chapter label', () => {
  it('offers the three shapes docs/15 lists', () => {
    expect(formatChapterLabel(301, 'short')).toBe('Ch. 301')
    expect(formatChapterLabel(301, 'long')).toBe('Chapter 301')
    expect(formatChapterLabel(301, 'hash')).toBe('#301')
    expect(formatChapterLabel(12.5, 'hash')).toBe('#12.5')
  })
})

describe('clock', () => {
  // Built in local time on purpose: this is what the browser renders after hydration.
  const at = (h: number, m: number) => new Date(2026, 8, 5, h, m)

  it('writes 24h with a leading zero and 12h with a suffix', () => {
    expect(formatTimeOfDay(at(14, 32), '24h')).toBe('14:32')
    expect(formatTimeOfDay(at(14, 32), '12h')).toBe('2:32 PM')
    expect(formatTimeOfDay(at(9, 5), '24h')).toBe('09:05')
    expect(formatTimeOfDay(at(9, 5), '12h')).toBe('9:05 AM')
  })

  it('gets both ends of the day right', () => {
    expect(formatTimeOfDay(at(0, 0), '12h')).toBe('12:00 AM')
    expect(formatTimeOfDay(at(12, 0), '12h')).toBe('12:00 PM')
    expect(formatTimeOfDay(at(0, 0), '24h')).toBe('00:00')
  })

  it('stamps a full date beside it', () => {
    expect(formatStamp(at(14, 32), '24h')).toBe('5 Sep 2026, 14:32')
    expect(formatStamp(at(14, 32), '12h')).toBe('5 Sep 2026, 2:32 PM')
  })
})

describe('the hover title', () => {
  it('stays the timezone-free date it has always been', () => {
    // The server renders this, so it must not depend on where the process runs.
    expect(formatIsoDate(new Date('2026-09-05T23:30:00Z'))).toBe('2026-09-05')
  })
})

describe('week start', () => {
  it('maps to the Date#getDay index the calendar counts from', () => {
    expect(weekStartIndex('monday')).toBe(1)
    expect(weekStartIndex('sunday')).toBe(0)
  })
})
