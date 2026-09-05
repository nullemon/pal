import { describe, expect, it } from 'vitest'
import {
  cardFingerprint,
  chapterOgPath,
  coverInitials,
  ellipsise,
  fitText,
  fitTitle,
  measureText,
  normaliseTint,
  OG_TEXT_WIDTH,
  seriesOgPath,
  TITLE_LINE_HEIGHT,
  TITLE_MAX_LINES,
  TITLE_SIZES,
  titleHeightBudget,
  wrapText,
} from './og-card'

/**
 * The share card is drawn once and then cached for a year, so text that does not fit is not
 * a glitch anybody catches — it is a broken preview on every share of that title from then
 * on. These are the cases the catalogue actually contains: a 70-character title, a title
 * that is one unbreakable word, `12.5`, and a series with no cover to take initials from.
 */

const TITLE_FLOOR = TITLE_SIZES[TITLE_SIZES.length - 1] ?? 44

/** The invariant the whole card rests on: no drawn line is wider than the text column. */
const everyLineFits = (lines: string[], fontSize: number, maxWidth = OG_TEXT_WIDTH) =>
  lines.every((line) => measureText(line, fontSize) <= maxWidth)

describe('measureText', () => {
  it('grows with the text and with the font size', () => {
    expect(measureText('aa', 40)).toBeGreaterThan(measureText('a', 40))
    expect(measureText('abc', 80)).toBeCloseTo(measureText('abc', 40) * 2, 5)
  })

  it('gives wide letters more room than narrow ones', () => {
    expect(measureText('mmmm', 40)).toBeGreaterThan(measureText('llll', 40))
  })

  it('is zero for the empty string', () => {
    expect(measureText('', 60)).toBe(0)
  })

  it('adds the tracking between characters only', () => {
    expect(measureText('ab', 40, 10)).toBeCloseTo(measureText('ab', 40) + 10, 5)
    expect(measureText('a', 40, 10)).toBeCloseTo(measureText('a', 40), 5)
  })
})

describe('wrapText', () => {
  it('keeps a short title on one line', () => {
    expect(wrapText('Ashfall Regent', 76, OG_TEXT_WIDTH)).toEqual(['Ashfall Regent'])
  })

  it('never returns a line wider than the column', () => {
    const title = 'The Villainess Keeps the Receipts and Refuses to Return Them to the Crown Prince'
    for (const size of TITLE_SIZES) {
      const lines = wrapText(title, size, OG_TEXT_WIDTH)
      expect(everyLineFits(lines, size)).toBe(true)
    }
  })

  it('hard-breaks a single word wider than the column rather than overflowing', () => {
    const lines = wrapText('Pneumonoultramicroscopicsilicovolcanoconiosis', 76, OG_TEXT_WIDTH)
    expect(lines.length).toBeGreaterThan(1)
    expect(everyLineFits(lines, 76)).toBe(true)
    expect(lines.join('')).toBe('Pneumonoultramicroscopicsilicovolcanoconiosis')
  })

  it('collapses nothing and drops nothing for ordinary titles', () => {
    const title = 'Return of the Frost Monarch (Novel)'
    expect(wrapText(title, 60, OG_TEXT_WIDTH).join(' ')).toBe(title)
  })

  it('is empty for whitespace only', () => {
    expect(wrapText('   ', 60, OG_TEXT_WIDTH)).toEqual([])
  })
})

describe('ellipsise', () => {
  it('leaves text that already fits alone', () => {
    expect(ellipsise('Short', 40, 1000)).toBe('Short')
  })

  it('cuts to the width and marks the cut', () => {
    const out = ellipsise('An extremely long series title that will not fit', 40, 300)
    expect(out.endsWith('…')).toBe(true)
    expect(measureText(out, 40)).toBeLessThanOrEqual(300)
  })

  it('does not leave a dangling space or dash before the ellipsis', () => {
    const out = ellipsise('Frost Monarch — the second coming', 40, 240)
    expect(out).not.toMatch(/[\s\-–—·]…$/)
  })

  it('always returns something, even at an impossible width', () => {
    expect(ellipsise('Frost', 40, 1)).not.toBe('')
  })
})

describe('fitText', () => {
  const opts = { maxWidth: 600, sizes: [80, 60, 40] as const, maxLines: 2 }

  it('takes the largest size that fits in the line budget', () => {
    const short = fitText('Ashfall', opts)
    expect(short.fontSize).toBe(80)
    expect(short.lines).toEqual(['Ashfall'])
    expect(short.truncated).toBe(false)
  })

  it('steps down a size rather than spilling onto an extra line', () => {
    const fitted = fitText('Chronicles of the Sunken Capital', opts)
    expect(fitted.lines.length).toBeLessThanOrEqual(opts.maxLines)
    expect(fitted.fontSize).toBeLessThan(80)
    expect(everyLineFits(fitted.lines, fitted.fontSize, opts.maxWidth)).toBe(true)
  })

  it('truncates at the smallest size instead of overflowing the card', () => {
    const fitted = fitText('word '.repeat(60), opts)
    expect(fitted.truncated).toBe(true)
    expect(fitted.fontSize).toBe(40)
    expect(fitted.lines).toHaveLength(opts.maxLines)
    expect(fitted.lines[fitted.lines.length - 1]?.endsWith('…')).toBe(true)
    expect(everyLineFits(fitted.lines, fitted.fontSize, opts.maxWidth)).toBe(true)
  })

  it('handles an empty title without throwing', () => {
    expect(fitText('   ', opts).lines).toEqual([])
  })
})

describe('fitTitle', () => {
  const titles = [
    'Ashfall Regent',
    'Return of the Frost Monarch (Novel)',
    'The Villainess Keeps the Receipts',
    'I Became the Ninefold Compass',
    // The kind of light-novel title that breaks naive layouts.
    'I Was Reincarnated as the Seventh Prince of a Fallen Kingdom and Now Everyone Wants Me Dead',
    'Pneumonoultramicroscopicsilicovolcanoconiosis',
    '転生したらスライムだった件について',
  ]

  it.each(titles)('fits %s inside the card', (title) => {
    for (const hasChapter of [false, true]) {
      const fitted = fitTitle(title, { hasChapter })
      expect(fitted.lines.length).toBeGreaterThan(0)
      expect(fitted.lines.length).toBeLessThanOrEqual(TITLE_MAX_LINES)
      expect(everyLineFits(fitted.lines, fitted.fontSize)).toBe(true)
      expect(TITLE_SIZES).toContain(fitted.fontSize as (typeof TITLE_SIZES)[number])
      // The block the card reserves must be the block the title actually occupies.
      expect(fitted.lines.length * fitted.lineBox).toBeLessThanOrEqual(
        titleHeightBudget(hasChapter),
      )
    }
  })

  it('gives a short title the biggest size and a long one the smallest', () => {
    expect(fitTitle('Ashfall Regent').fontSize).toBe(TITLE_SIZES[0])
    const long = fitTitle(
      'I Was Reincarnated as the Seventh Prince of a Fallen Kingdom and Now Everyone Wants Me Dead',
    )
    expect(long.fontSize).toBe(TITLE_FLOOR)
  })

  it('shrinks further on a chapter card, where the badge takes the room', () => {
    const title = 'Pneumonoultramicroscopicsilicovolcanoconiosis'
    const series = fitTitle(title, { hasChapter: false })
    const chapter = fitTitle(title, { hasChapter: true })
    expect(chapter.fontSize).toBeLessThanOrEqual(series.fontSize)
    expect(chapter.lines.length).toBeLessThanOrEqual(series.lines.length)
  })

  it('reports the line box the renderer must set on each line', () => {
    const fitted = fitTitle('Ashfall Regent')
    expect(fitted.lineBox).toBe(Math.round(fitted.fontSize * TITLE_LINE_HEIGHT))
  })

  it('marks — and ellipsises — a title too long even for three lines at the floor', () => {
    const fitted = fitTitle('Chronicles of the Sunken Capital '.repeat(8))
    expect(fitted.truncated).toBe(true)
    expect(fitted.lines).toHaveLength(TITLE_MAX_LINES)
    expect(fitted.lines[TITLE_MAX_LINES - 1]?.endsWith('…')).toBe(true)
    expect(everyLineFits(fitted.lines, fitted.fontSize)).toBe(true)
  })

  it('normalises the whitespace a pasted title arrives with', () => {
    expect(fitTitle('  Ashfall   Regent \n').lines).toEqual(['Ashfall Regent'])
  })
})

describe('titleHeightBudget', () => {
  it('leaves less room when a chapter badge has to fit too', () => {
    expect(titleHeightBudget(true)).toBeLessThan(titleHeightBudget(false))
  })

  it('still leaves room for at least two lines at the floor size', () => {
    const floorBox = Math.round(TITLE_FLOOR * TITLE_LINE_HEIGHT)
    expect(titleHeightBudget(true)).toBeGreaterThanOrEqual(floorBox * 2)
  })
})

describe('coverInitials', () => {
  it.each([
    ['Return of the Frost Monarch', 'RF'],
    ['Ashfall Regent', 'AR'],
    ['Solo', 'S'],
    ['12 Ways to Fall', 'WF'],
    ['— · —', '?'],
    ['', '?'],
    ['blood-iron-academy', 'BI'],
  ])('takes %s → %s', (title, expected) => {
    expect(coverInitials(title)).toBe(expected)
  })

  it('never returns more than two characters', () => {
    expect(coverInitials('One Two Three Four Five').length).toBeLessThanOrEqual(2)
  })
})

describe('normaliseTint', () => {
  it.each([
    ['#1a2b3c', '#1a2b3c'],
    ['#ABC', '#abc'],
    ['  #1A2B3C  ', '#1a2b3c'],
  ])('accepts %s', (input, expected) => {
    expect(normaliseTint(input)).toBe(expected)
  })

  it.each([null, undefined, '', 'red', '#12345', 'rgb(1,2,3)', '#1a2b3c; drop table'])(
    'rejects %s',
    (input) => {
      expect(normaliseTint(input)).toBeNull()
    },
  )
})

describe('cardFingerprint', () => {
  it('is stable for the same inputs', () => {
    expect(cardFingerprint(['a', 1, null])).toBe(cardFingerprint(['a', 1, null]))
  })

  it('changes when any input changes', () => {
    const base = cardFingerprint(['Ashfall Regent', 'manhwa', 154, '12.5'])
    expect(cardFingerprint(['Ashfall Regent', 'manhwa', 155, '12.5'])).not.toBe(base)
    expect(cardFingerprint(['Ashfall Regents', 'manhwa', 154, '12.5'])).not.toBe(base)
    expect(cardFingerprint(['Ashfall Regent', 'manhwa', 154, '12'])).not.toBe(base)
  })

  it('does not collapse a field boundary shift', () => {
    expect(cardFingerprint(['ab', 'c'])).not.toBe(cardFingerprint(['a', 'bc']))
  })

  it('is URL-safe and short', () => {
    expect(cardFingerprint(['Ashfall Regent — 第1話'])).toMatch(/^[a-z0-9]{1,12}$/)
  })
})

describe('og paths', () => {
  it('builds a versioned series URL', () => {
    expect(seriesOgPath('ashfall-regent', 'abc123')).toBe('/api/og/series/ashfall-regent?v=abc123')
  })

  it('keeps a fractional chapter number intact', () => {
    expect(chapterOgPath('ashfall-regent', '12.5', 'abc123')).toBe(
      '/api/og/chapter/ashfall-regent/12.5?v=abc123',
    )
  })

  it('escapes a slug that would otherwise change the path', () => {
    expect(seriesOgPath('a/b', 'v')).toBe('/api/og/series/a%2Fb?v=v')
  })
})
