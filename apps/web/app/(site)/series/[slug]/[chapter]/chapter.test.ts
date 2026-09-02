import { describe, expect, it } from 'vitest'
import {
  chapterHref,
  formatChapterNumber,
  parseChapterSegment,
} from '../../../../../components/reader/params'
import { pickVariant } from '../../../../../components/reader/quality'
import {
  buildSequence,
  itemIndexOfPage,
  nextItemIndex,
  pageOfItem,
  prevItemIndex,
  spreadAt,
} from '../../../../../components/reader/sequence'
import { parseReaderSiteSettings } from '../../../../../components/reader/server/settings'
import { defaultSettings, parseStoredSettings } from '../../../../../components/reader/settings'
import type { ReaderPage } from '../../../../../components/reader/types'

describe('chapter segment', () => {
  it('parses chapter-<n> including decimals', () => {
    expect(parseChapterSegment('chapter-301')).toBe(301)
    expect(parseChapterSegment('chapter-12.5')).toBe(12.5)
    expect(parseChapterSegment('chapter-0')).toBe(0)
  })
  it('rejects anything else', () => {
    expect(parseChapterSegment('301')).toBeNull()
    expect(parseChapterSegment('chapter-')).toBeNull()
    expect(parseChapterSegment('chapter-abc')).toBeNull()
    expect(parseChapterSegment('feed')).toBeNull()
    expect(parseChapterSegment(undefined)).toBeNull()
  })
  it('formats hrefs without trailing zeros', () => {
    expect(formatChapterNumber(301)).toBe('301')
    expect(formatChapterNumber(12.5)).toBe('12.5')
    expect(chapterHref('frost', 7.1)).toBe('/series/frost/chapter-7.1')
  })
})

describe('sequence', () => {
  it('inserts an ad after every N pages on mobile, never after the last, then the end panel', () => {
    const items = buildSequence({ pageCount: 8, interval: 4, mobile: true, adsEnabled: true })
    expect(items.map((i) => i.kind)).toEqual([
      'page',
      'page',
      'page',
      'page',
      'ad',
      'page',
      'page',
      'page',
      'page',
      'end',
    ])
  })
  it('has no ads on desktop, when off, or for ad-free readers', () => {
    const plain = ['page', 'page', 'page', 'end']
    expect(
      buildSequence({ pageCount: 3, interval: 2, mobile: false, adsEnabled: true }).map(
        (i) => i.kind,
      ),
    ).toEqual(plain)
    expect(
      buildSequence({ pageCount: 3, interval: 0, mobile: true, adsEnabled: true }).map(
        (i) => i.kind,
      ),
    ).toEqual(plain)
    expect(
      buildSequence({ pageCount: 3, interval: 2, mobile: true, adsEnabled: false }).map(
        (i) => i.kind,
      ),
    ).toEqual(plain)
  })
  it('maps pages to items and back, so a mode switch keeps the place', () => {
    const items = buildSequence({ pageCount: 6, interval: 2, mobile: true, adsEnabled: true })
    expect(itemIndexOfPage(items, 2)).toBe(3)
    expect(pageOfItem(items, 2)).toBe(1) // the ad after page 2 still counts as page 2
    expect(pageOfItem(items, items.length - 1)).toBe(5)
    expect(itemIndexOfPage(items, 99)).toBe(items.length - 1)
  })
  it('spreads pages in pairs after the cover in double-page mode', () => {
    const items = buildSequence({ pageCount: 5, interval: 0, mobile: false, adsEnabled: false })
    expect(spreadAt(items, 0, 'double')).toEqual([0])
    expect(spreadAt(items, 1, 'double')).toEqual([1, 2])
    expect(spreadAt(items, 2, 'double')).toEqual([2])
    expect(spreadAt(items, 1, 'single')).toEqual([1])
    expect(nextItemIndex(items, 1, 'double')).toBe(3)
    expect(prevItemIndex(items, 3, 'double')).toBe(1)
    expect(nextItemIndex(items, 4, 'single')).toBe(5)
    expect(nextItemIndex(items, 5, 'single')).toBe(5)
  })
})

describe('quality', () => {
  const page: ReaderPage = {
    idx: 0,
    width: 1600,
    height: 2400,
    blurHash: null,
    url: '/_storage/pages/orig.avif',
    variants: [
      { w: 800, url: '/800' },
      { w: 1200, url: '/1200' },
      { w: 1600, url: '/1600' },
    ],
  }
  it('serves the width variant for the quality setting', () => {
    expect(pickVariant(page, 'high', 400)).toBe('/1600')
    expect(pickVariant(page, 'saver', 1400)).toBe('/800')
    expect(pickVariant(page, 'auto', 820, 1)).toBe('/1200')
    expect(pickVariant(page, 'auto', 390, 3)).toBe('/800')
    expect(pickVariant(page, 'auto', 1400, 2)).toBe('/1600')
  })
  it('falls back to the original without variants', () => {
    expect(pickVariant({ ...page, variants: [] }, 'auto', 820)).toBe(page.url)
  })
})

describe('settings', () => {
  const defaults = defaultSettings({
    mode: 'strip',
    direction: 'rtl',
    background: 'dark',
    narrow: false,
  })
  it('defaults from the admin mode, series direction and viewport', () => {
    expect(defaults).toMatchObject({
      mode: 'strip',
      direction: 'rtl',
      fit: 'height',
      preload: 5,
      gap: 0,
    })
    expect(
      defaultSettings({ mode: 'paged', direction: 'ltr', background: 'black', narrow: true }),
    ).toMatchObject({
      mode: 'single',
      fit: 'width',
      background: 'black',
    })
  })
  it('merges a stored blob field by field and ignores bad values', () => {
    expect(
      parseStoredSettings(
        { mode: 'double', preload: 99, background: 'sepia', fit: 'nope' },
        defaults,
      ),
    ).toEqual({
      ...defaults,
      mode: 'double',
      background: 'sepia',
    })
    expect(parseStoredSettings('garbage', defaults)).toEqual(defaults)
    expect(parseStoredSettings(null, defaults)).toEqual(defaults)
  })
  it('reads the admin rows with docs/06 defaults for anything missing', () => {
    const s = parseReaderSiteSettings(
      { home: 'A', reader: { default_mode: 'paged' } },
      {
        reader: { skyscrapers: false, sky_size: '300x600', mobile_interval: 6 },
        slots: { reader_end: { enabled: true, tag: 'x' } },
      },
    )
    expect(s.layout).toEqual({ default_mode: 'paged', background: 'dark' })
    expect(s.ads).toEqual({
      skyscrapers: false,
      sky_size: '300x600',
      mobile_interval: 6,
      end_slot: true,
    })
    expect(s.endTag).toBe('x')
    const d = parseReaderSiteSettings(null, { reader: { mobile_interval: 5 } })
    expect(d.ads.mobile_interval).toBe(4)
    expect(d.layout.default_mode).toBe('strip')
  })
})
