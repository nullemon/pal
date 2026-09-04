import { describe, expect, it } from 'vitest'
import { pickVariant } from '@/components/reader/quality'
import type { ReaderData, ReaderPage } from '@/components/reader/types'
import { bestUrl, formatBytes, pinToCachedVariant } from './format'

const page = (idx: number, variants: Array<[number, string]>): ReaderPage => ({
  idx,
  width: 800,
  height: 1200,
  blurHash: null,
  url: `/orig-${idx}.webp`,
  variants: variants.map(([w, url]) => ({ w, url })),
})

const data = (pages: ReaderPage[]): ReaderData =>
  ({ pages, nextPagesEndpoint: '/api/chapters/9/pages?limit=3' }) as unknown as ReaderData

describe('formatBytes', () => {
  it('uses decimal units, the way a storage screen does', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1000)).toBe('1.0 kB')
    expect(formatBytes(99_400)).toBe('99.4 kB')
    expect(formatBytes(129_645)).toBe('130 kB')
    expect(formatBytes(48_200_000)).toBe('48.2 MB')
    // Past 100 in a unit the decimal is noise, so it rounds.
    expect(formatBytes(523_000_000)).toBe('523 MB')
    expect(formatBytes(2_400_000_000)).toBe('2.4 GB')
  })
  it('never renders a negative or non-finite size', () => {
    expect(formatBytes(-1)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B')
  })
})

describe('choosing what to cache', () => {
  it('takes the largest encode, whatever order the variants arrive in', () => {
    expect(
      bestUrl(
        page(0, [
          [720, '/a-720'],
          [1440, '/a-1440'],
          [360, '/a-360'],
        ]),
      ),
    ).toBe('/a-1440')
    expect(
      bestUrl(
        page(0, [
          [1440, '/a-1440'],
          [720, '/a-720'],
        ]),
      ),
    ).toBe('/a-1440')
  })
  it('falls back to the original when a chapter has no variants', () => {
    expect(bestUrl(page(3, []))).toBe('/orig-3.webp')
  })
})

describe('pinning a download to the encode that was cached', () => {
  const pinned = pinToCachedVariant(
    data([
      page(0, [
        [720, '/p0-720'],
        [1440, '/p0-1440'],
      ]),
      page(1, []),
    ]),
  )

  it('points every page at the cached URL', () => {
    expect(pinned.pages[0]?.url).toBe('/p0-1440')
    expect(pinned.pages[1]?.url).toBe('/orig-1.webp')
  })

  it('leaves the reader no other variant to pick', () => {
    expect(pinned.pages[0]?.variants).toEqual([{ w: 1440, url: '/p0-1440' }])
    expect(pinned.pages[1]?.variants).toEqual([])
  })

  /**
   * The point of pinning: offline only one encode exists, so every quality setting and every
   * rendered width must resolve to it. Without this the reader asks for a URL nobody cached
   * and the page is blank with no network.
   */
  it('resolves to the cached URL at every quality and width', () => {
    const p0 = pinned.pages[0] as ReaderPage
    for (const quality of ['auto', 'high', 'saver'] as const) {
      for (const width of [320, 800, 2000]) {
        expect(pickVariant(p0, quality, width, 3)).toBe('/p0-1440')
      }
    }
  })

  it('drops the next-chapter prefetch, which cannot work offline', () => {
    expect(pinned.nextPagesEndpoint).toBe(null)
  })

  it('does not mutate the payload it was given', () => {
    const original = data([
      page(0, [
        [720, '/x-720'],
        [1440, '/x-1440'],
      ]),
    ])
    pinToCachedVariant(original)
    expect(original.pages[0]?.variants).toHaveLength(2)
    expect(original.nextPagesEndpoint).toBe('/api/chapters/9/pages?limit=3')
  })
})
