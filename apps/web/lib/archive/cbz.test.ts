import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  archiveFileName,
  type CbzEntry,
  cbzEntryName,
  cbzStream,
  chapterArchiveEntries,
  comicInfoXml,
} from './cbz'

const meta = {
  seriesTitle: 'Return of the Frost Monarch',
  seriesSlug: 'return-of-the-frost-monarch',
  number: '304',
  chapterTitle: 'The Long Night',
  pageCount: 3,
  readingDirection: 'vertical' as const,
  url: 'https://palscans.org/series/return-of-the-frost-monarch/chapter-304',
  siteName: 'PALScans',
}

const collect = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

const page = (n: number) => new Uint8Array(Array.from({ length: 64 }, (_, i) => (n * 7 + i) % 256))

describe('cbzEntryName', () => {
  it('zero-pads to at least three digits so readers sort pages correctly', () => {
    expect(cbzEntryName(0, 'pages/1/2/0000-abc.1440.webp', 5)).toBe('001.webp')
    expect(cbzEntryName(9, 'pages/1/2/0090-abc.1440.webp', 40)).toBe('010.webp')
  })

  it('widens the padding past a thousand pages so 1000 still sorts after 999', () => {
    expect(cbzEntryName(0, 'a.webp', 1200)).toBe('0001.webp')
    expect(cbzEntryName(999, 'a.webp', 1200)).toBe('1000.webp')
    const names = [cbzEntryName(998, 'a.webp', 1200), cbzEntryName(999, 'a.webp', 1200)]
    expect([...names].sort()).toEqual(names)
  })

  it('keeps the real extension and falls back when there is none', () => {
    expect(cbzEntryName(0, 'x.avif', 3)).toBe('001.avif')
    expect(cbzEntryName(0, 'pages/1/2/0000-abc', 3)).toBe('001.jpg')
  })
})

describe('archiveFileName', () => {
  it('is a safe, recognisable file name', () => {
    expect(archiveFileName({ seriesSlug: 'frost-monarch', number: '304' })).toBe(
      'frost-monarch-ch-304',
    )
    expect(archiveFileName({ seriesSlug: 'frost-monarch', number: '12.5' })).toBe(
      'frost-monarch-ch-12.5',
    )
  })

  it('strips anything a header or a filesystem would choke on', () => {
    expect(archiveFileName({ seriesSlug: 'a/../b "x"', number: '1' })).toBe('a-b-x-ch-1')
  })
})

describe('comicInfoXml', () => {
  it('carries the series, the chapter and a link back to the site', () => {
    const xml = comicInfoXml(meta)
    expect(xml).toContain('<Series>Return of the Frost Monarch</Series>')
    expect(xml).toContain('<Number>304</Number>')
    expect(xml).toContain('<PageCount>3</PageCount>')
    expect(xml).toContain(`<Web>${meta.url}</Web>`)
  })

  it('marks a right-to-left series so readers page the correct way', () => {
    expect(comicInfoXml({ ...meta, readingDirection: 'rtl' })).toContain(
      '<Manga>YesAndRightToLeft</Manga>',
    )
    expect(comicInfoXml({ ...meta, readingDirection: 'ltr' })).toContain('<Manga>Yes</Manga>')
  })

  it('escapes titles rather than emitting broken XML', () => {
    const xml = comicInfoXml({ ...meta, seriesTitle: 'Tom & Jerry <hero>' })
    expect(xml).toContain('Tom &amp; Jerry &lt;hero&gt;')
  })
})

describe('cbzStream', () => {
  const entries: CbzEntry[] = [
    { name: '001.webp', read: async () => page(1) },
    { name: '002.webp', read: async () => page(2) },
    { name: '003.webp', read: async () => page(3) },
  ]

  it('produces a ZIP that unzips back to the same bytes, in order', async () => {
    const zip = await collect(cbzStream(entries))
    expect(zip[0]).toBe(0x50)
    expect(zip[1]).toBe(0x4b)
    const files = unzipSync(zip)
    expect(Object.keys(files)).toEqual(['001.webp', '002.webp', '003.webp'])
    expect(files['001.webp']).toEqual(page(1))
    expect(files['002.webp']).toEqual(page(2))
    expect(files['003.webp']).toEqual(page(3))
  })

  it('stores rather than deflates — an already-compressed page must not be re-compressed', async () => {
    const big = new Uint8Array(200_000)
    for (let i = 0; i < big.length; i++) big[i] = i % 251
    const zip = await collect(cbzStream([{ name: '001.webp', read: async () => big }]))
    // Store adds only the headers, so the archive is barely larger than the payload.
    expect(zip.byteLength).toBeGreaterThanOrEqual(big.byteLength)
    expect(zip.byteLength).toBeLessThan(big.byteLength + 512)
  })

  it('reads one entry at a time, and only when the consumer asks', async () => {
    const order: string[] = []
    const lazy: CbzEntry[] = ['a', 'b', 'c'].map((name, i) => ({
      name: `${name}.webp`,
      read: async () => {
        order.push(name)
        return page(i)
      },
    }))
    const stream = cbzStream(lazy)
    const reader = stream.getReader()
    await reader.read()
    // The first pull must not have dragged the whole chapter into memory behind it.
    expect(order.length).toBeLessThan(lazy.length)
    await reader.cancel()
  })

  it('errors instead of shipping a truncated archive when a page is missing', async () => {
    const missing: string[] = []
    const stream = cbzStream(
      [
        { name: '001.webp', read: async () => page(1) },
        { name: '002.webp', read: async () => null },
      ],
      { onMissing: (n) => missing.push(n) },
    )
    await expect(collect(stream)).rejects.toThrow(/missing archive entry: 002\.webp/)
    expect(missing).toEqual(['002.webp'])
  })

  it('survives a reader cancelling mid-page instead of throwing behind the request', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const stream = cbzStream([
      { name: '001.webp', read: async () => page(1) },
      {
        name: '002.webp',
        read: async () => {
          await gate
          return page(2)
        },
      },
    ])
    const reader = stream.getReader()
    await reader.read()
    const pending = reader.read()
    await reader.cancel()
    release()
    await expect(pending).resolves.toBeDefined()
    // The slow page resolving after the cancel must not blow up the terminated archive.
    await new Promise((resolve) => setTimeout(resolve, 10))
  })

  it('propagates a storage failure rather than hanging', async () => {
    const stream = cbzStream([
      {
        name: '001.webp',
        read: async () => {
          throw new Error('bucket unreachable')
        },
      },
    ])
    await expect(collect(stream)).rejects.toThrow(/bucket unreachable/)
  })

  it('is byte-identical for the same chapter twice', async () => {
    const a = await collect(cbzStream(entries))
    const b = await collect(cbzStream(entries))
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })
})

describe('chapterArchiveEntries', () => {
  const keys = [
    'pages/1/2/0000-aaa.1440.webp',
    'pages/1/2/0010-bbb.1440.webp',
    'pages/1/2/0020-ccc.1440.webp',
  ]

  it('lays the pages out in reading order with the metadata last', () => {
    const entries = chapterArchiveEntries({
      ...meta,
      keys,
      read: async () => page(1),
    })
    expect(entries.map((e) => e.name)).toEqual([
      '001.webp',
      '002.webp',
      '003.webp',
      'ComicInfo.xml',
    ])
  })

  it('round-trips through a real archive with the page count the reader will see', async () => {
    const bytes = new Map(keys.map((k, i) => [k, page(i + 1)]))
    const zip = await collect(
      cbzStream(
        chapterArchiveEntries({
          ...meta,
          keys,
          read: async (key) => bytes.get(key) ?? null,
        }),
      ),
    )
    const files = unzipSync(zip)
    const names = Object.keys(files).filter((n) => n !== 'ComicInfo.xml')
    expect(names).toEqual(['001.webp', '002.webp', '003.webp'])
    expect(files['002.webp']).toEqual(page(2))
    const info = new TextDecoder().decode(files['ComicInfo.xml'] as Uint8Array)
    expect(info).toContain('<PageCount>3</PageCount>')
  })
})
