import { describe, expect, it } from 'vitest'
import {
  manifestChapterUrl,
  manifestFingerprint,
  manifestRawUrl,
  parseManifest,
} from '../manifest.js'
import { GalleryError } from '../types.js'

/**
 * Cubari-style series manifests.
 *
 * The shapes here are taken from eleven published manifests (210 chapters), not invented:
 * every group value in those files is a `/proxy/api/imgur/chapter/<id>/` path, chapter keys
 * are decimal strings so `3.1` is normal, and `last_updated` is epoch seconds as a string.
 */

const chapter = (over: Record<string, unknown> = {}) => ({
  title: 'A chapter',
  volume: '1',
  groups: { 'Some Group': '/proxy/api/imgur/chapter/mPTTseC/' },
  last_updated: '1617673932',
  ...over,
})

const manifest = (over: Record<string, unknown> = {}) => ({
  title: 'A series',
  description: 'about things',
  author: 'Someone',
  artist: 'Someone',
  cover: 'https://cdn.example.com/cover.jpg',
  chapters: { '1': chapter() },
  ...over,
})

const codeOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (error) {
    return error instanceof GalleryError ? error.code : `threw ${String(error)}`
  }
  return 'did not throw'
}

describe('parseManifest', () => {
  it('reads the series metadata', () => {
    const m = parseManifest(manifest())
    expect(m.title).toBe('A series')
    expect(m.author).toBe('Someone')
    expect(m.artist).toBe('Someone')
    expect(m.description).toBe('about things')
    expect(m.cover).toBe('https://cdn.example.com/cover.jpg')
  })

  it('reads an imgur proxy path as an imgur album', () => {
    const [first] = parseManifest(manifest()).chapters
    expect(first?.source).toEqual({ kind: 'gallery', provider: 'imgur', id: 'mPTTseC' })
    expect(first?.group).toBe('Some Group')
    expect(first?.volume).toBe(1)
  })

  it('reads an imgchest proxy path too', () => {
    const m = parseManifest(
      manifest({
        chapters: {
          '1': chapter({ groups: { G: '/proxy/api/imgchest/chapter/na7kjb9bq48/' } }),
        },
      }),
    )
    expect(m.chapters[0]?.source).toEqual({
      kind: 'gallery',
      provider: 'imgchest',
      id: 'na7kjb9bq48',
    })
  })

  it('reads a plain array of image URLs, for hand-written manifests', () => {
    const m = parseManifest(
      manifest({
        chapters: {
          '1': chapter({
            groups: { G: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'] },
          }),
        },
      }),
    )
    expect(m.chapters[0]?.source).toEqual({
      kind: 'direct',
      links: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'],
    })
  })

  it('handles decimal chapter keys, which are normal', () => {
    const m = parseManifest(
      manifest({ chapters: { '3.1': chapter(), '3': chapter(), '10': chapter() } }),
    )
    expect(m.chapters.map((c) => c.number)).toEqual([3, 3.1, 10])
  })

  it('sorts numerically, because a hand-edited file is in append order', () => {
    // JSON objects keep insertion order, so "1, 10, 11, 2" is the normal state of a manifest
    // somebody has been adding to for two years.
    const m = parseManifest(
      manifest({ chapters: { '1': chapter(), '10': chapter(), '11': chapter(), '2': chapter() } }),
    )
    expect(m.chapters.map((c) => c.number)).toEqual([1, 2, 10, 11])
  })

  it('skips the entries it cannot read and imports the rest', () => {
    // The whole point. A 200-chapter manifest with three bad entries must import 197 and
    // report three, not fail entirely — failing is what makes the feature useless on exactly
    // the large files it exists for.
    const m = parseManifest(
      manifest({
        chapters: {
          '1': chapter(),
          '2': chapter({ groups: { G: '/proxy/api/mangadex/chapter/abc/' } }),
          '3': chapter({ groups: {} }),
          extras: chapter(),
          '5': chapter(),
        },
      }),
    )
    expect(m.chapters.map((c) => c.number)).toEqual([1, 5])
    expect(m.skipped.map((s) => s.key).sort()).toEqual(['2', '3', 'extras'])
    expect(m.skipped.find((s) => s.key === '2')?.reason).toContain('mangadex')
  })

  it('prefers a named group when one is asked for', () => {
    const m = parseManifest(
      manifest({
        chapters: {
          '1': chapter({
            groups: {
              Other: '/proxy/api/imgur/chapter/aaaaaaa/',
              Wanted: '/proxy/api/imgur/chapter/bbbbbbb/',
            },
          }),
        },
      }),
      { group: 'wanted' },
    )
    expect(m.chapters[0]?.source).toEqual({ kind: 'gallery', provider: 'imgur', id: 'bbbbbbb' })
  })

  it('falls back to the first group when the preferred one is absent', () => {
    const m = parseManifest(manifest(), { group: 'Nobody' })
    expect(m.chapters[0]?.group).toBe('Some Group')
  })

  it('reads last_updated as epoch seconds, and ignores nonsense', () => {
    const ok = parseManifest(manifest())
    expect(ok.chapters[0]?.updatedAt?.getUTCFullYear()).toBe(2021)
    const bad = parseManifest(
      manifest({ chapters: { '1': chapter({ last_updated: 'yesterday' }) } }),
    )
    expect(bad.chapters[0]?.updatedAt).toBeNull()
  })

  it('reads a volume written as text', () => {
    const m = parseManifest(manifest({ chapters: { '1': chapter({ volume: 'Volume 3' }) } }))
    expect(m.chapters[0]?.volume).toBe(3)
  })

  it('drops a cover that points somewhere private', () => {
    // The cover is fetched server-side like any other image, so it gets the same guard.
    const m = parseManifest(manifest({ cover: 'http://169.254.169.254/latest/meta-data/' }))
    expect(m.cover).toBeNull()
  })

  it('distinguishes a manifest with no chapters from one that is not a manifest', () => {
    // `empty` means the file was understood and has nothing in it; `unparseable` means we
    // could not read it at all. The operator's next move differs, so the codes have to.
    expect(codeOf(() => parseManifest(manifest({ chapters: {} })))).toBe('empty')
    expect(
      codeOf(() =>
        parseManifest(manifest({ chapters: { '1': chapter({ groups: { G: 'nonsense' } }) } })),
      ),
    ).toBe('empty')
    expect(codeOf(() => parseManifest({ title: 'x' }))).toBe('unparseable')
    expect(codeOf(() => parseManifest({ title: 'x', chapters: 'nope' }))).toBe('unparseable')
  })

  it('refuses something that is not a manifest', () => {
    expect(codeOf(() => parseManifest({ hello: true }))).toBe('unparseable')
    expect(codeOf(() => parseManifest(null))).toBe('unparseable')
    expect(codeOf(() => parseManifest([1, 2, 3]))).toBe('unparseable')
  })
})

describe('manifestRawUrl', () => {
  it('rewrites the GitHub page URL an operator actually pastes', () => {
    // People paste the page they are looking at; /blob/ answers with HTML.
    expect(manifestRawUrl('https://github.com/someone/repo/blob/main/series.json')).toBe(
      'https://raw.githubusercontent.com/someone/repo/main/series.json',
    )
  })

  it('passes a raw URL through unchanged', () => {
    const raw = 'https://raw.githubusercontent.com/someone/repo/main/series.json'
    expect(manifestRawUrl(raw)).toBe(raw)
  })

  it('turns a gist page into its raw form', () => {
    expect(manifestRawUrl('https://gist.github.com/someone/6e39ed38e5c38093b6835e0f083049c6')).toBe(
      'https://gist.githubusercontent.com/someone/6e39ed38e5c38093b6835e0f083049c6/raw',
    )
  })

  it('unpins a gist raw URL, which is the one the Raw button hands you', () => {
    // `/raw/<sha>/file` is that gist frozen at a revision. It is what GitHub gives you when
    // you click Raw, so it is what gets pasted — and following it means the gist updates
    // while the sync re-reads the same bytes forever and reports success.
    expect(
      manifestRawUrl(
        'https://gist.githubusercontent.com/someone/6e39ed38e5c38093b6835e0f083049c6/raw/0123456789abcdef0123456789abcdef01234567/series.json',
      ),
    ).toBe(
      'https://gist.githubusercontent.com/someone/6e39ed38e5c38093b6835e0f083049c6/raw/series.json',
    )
  })

  it('leaves an already-unpinned gist raw URL alone', () => {
    const raw =
      'https://gist.githubusercontent.com/someone/6e39ed38e5c38093b6835e0f083049c6/raw/series.json'
    expect(manifestRawUrl(raw)).toBe(raw)
    const bare = 'https://gist.githubusercontent.com/someone/6e39ed38e5c38093b6835e0f083049c6/raw'
    expect(manifestRawUrl(bare)).toBe(bare)
  })

  it('refuses anything else, including http and other hosts', () => {
    for (const url of [
      'https://example.com/series.json',
      'http://github.com/a/b/blob/main/x.json',
      'https://github.com/someone/repo',
      'not a url',
    ])
      expect(manifestRawUrl(url), url).toBeNull()
  })
})

describe('manifestChapterUrl', () => {
  it('rebuilds the canonical gallery URL rather than echoing the proxy path', () => {
    const parsed = parseManifest(manifest())
    expect(parsed.chapters.map(manifestChapterUrl)).toEqual(['https://imgur.com/a/mPTTseC'])
  })

  it('uses the first image for a chapter listed as direct links', () => {
    const parsed = parseManifest(
      manifest({
        chapters: {
          '1': chapter({
            groups: {
              G: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'],
            },
          }),
        },
      }),
    )
    expect(parsed.chapters.map(manifestChapterUrl)).toEqual(['https://cdn.example.com/a.png'])
  })
})

/**
 * The change detector behind the sync. What it must get right is not "is this file
 * different" but "is there a chapter here that was not here before, or one now pointing
 * somewhere else" — a reformat or an edited description must look identical, or every check
 * of every followed series walks the chapter table for nothing.
 */
describe('manifestFingerprint', () => {
  const fingerprintOf = (over: Record<string, unknown>) =>
    manifestFingerprint(parseManifest(manifest(over)))

  it('is stable across an edit that changes no chapter source', () => {
    const before = fingerprintOf({ chapters: { '1': chapter() } })
    const after = fingerprintOf({
      description: 'rewritten',
      chapters: { '1': chapter({ title: 'Renamed', last_updated: '1700000000' }) },
    })
    expect(after).toBe(before)
  })

  it('is stable when the same chapters arrive in another key order', () => {
    const a = fingerprintOf({ chapters: { '1': chapter(), '2': chapter() } })
    const b = fingerprintOf({ chapters: { '2': chapter(), '1': chapter() } })
    expect(b).toBe(a)
  })

  it('moves when a chapter is added', () => {
    const before = fingerprintOf({ chapters: { '1': chapter() } })
    const after = fingerprintOf({ chapters: { '1': chapter(), '2': chapter() } })
    expect(after).not.toBe(before)
  })

  it('moves when a chapter is repointed at another gallery', () => {
    const before = fingerprintOf({ chapters: { '1': chapter() } })
    const after = fingerprintOf({
      chapters: { '1': chapter({ groups: { G: '/proxy/api/imgur/chapter/XXXXXXX/' } }) },
    })
    expect(after).not.toBe(before)
  })
})
