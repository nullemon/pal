import { describe, expect, it } from 'vitest'
import { isIndexable, metadataFor } from './metadata'
import { DEFAULT_SEO_SETTINGS, type SeoSettings } from './settings'

const env = { siteUrl: 'https://palscans.org', defaultOgImage: '/og-default.png' }
const settings = (patch: Partial<SeoSettings> = {}): SeoSettings => ({
  ...DEFAULT_SEO_SETTINGS,
  ...patch,
})

describe('metadataFor (docs/12 §2, §7)', () => {
  it('renders the series template with variables and truncation', () => {
    const meta = metadataFor(settings(), env, 'series', {
      path: '/series/solo-leveling',
      vars: {
        title: 'Solo Leveling',
        type: 'Manhwa',
        chapter_count: 179,
        latest_chapter: 'Ch. 179',
        synopsis: 'word '.repeat(80),
      },
      feed: '/series/solo-leveling/feed',
      image: '/_storage/covers/a.svg',
    })
    expect(meta.title).toEqual({ absolute: 'Solo Leveling — Read Online Free · PALScans' })
    expect(meta.description).toMatch(
      /^Read Solo Leveling Manhwa online\. 179 chapters, latest Ch\. 179\./,
    )
    expect(String(meta.description).length).toBeLessThanOrEqual(300)
    expect(meta.alternates?.canonical).toBe('https://palscans.org/series/solo-leveling')
    expect(meta.robots).toEqual({ index: true, follow: true, 'max-image-preview': 'large' })
    const og = meta.openGraph as { images: { url: string }[]; type: string }
    expect(og.images[0]?.url).toBe('https://palscans.org/_storage/covers/a.svg')
    expect(og.type).toBe('website')
    const types = meta.alternates?.types as Record<string, { url: string }[]>
    expect(types['application/rss+xml']?.[0]?.url).toBe(
      'https://palscans.org/series/solo-leveling/feed',
    )
    expect(types['application/atom+xml']?.[0]?.url).toBe(
      'https://palscans.org/series/solo-leveling/feed?format=atom',
    )
  })

  it('admin template overrides and per-entity overrides win in that order', () => {
    const custom = settings({
      templates: {
        ...DEFAULT_SEO_SETTINGS.templates,
        genre: { title: '{genre} comics on {site}', description: '' },
      },
    })
    const templated = metadataFor(custom, env, 'genre', {
      path: '/genres/action',
      vars: { genre: 'Action', count: 12, intro: 'Fights.' },
    })
    expect(templated.title).toEqual({ absolute: 'Action comics on PALScans' })
    expect(templated.description).toBe('Browse 12 Action series on PALScans. Fights.')

    const overridden = metadataFor(custom, env, 'genre', {
      path: '/genres/action',
      vars: { genre: 'Action' },
      override: { title: 'Action Manhwa', description: 'Custom.' },
    })
    expect(overridden.title).toEqual({ absolute: 'Action Manhwa' })
    expect(overridden.description).toBe('Custom.')
  })

  it('static pages get "{title} · {site}" and the default description', () => {
    const meta = metadataFor(settings(), env, 'page', {
      path: '/terms',
      override: { title: 'Terms of service' },
    })
    expect(meta.title).toEqual({ absolute: 'Terms of service · PALScans' })
    expect(meta.description).toBe(DEFAULT_SEO_SETTINGS.identity.default_description)
  })

  it('applies the visibility rules', () => {
    const s = settings({
      indexing: { site: true, chapters: false, profiles: false, browse_filters: false },
    })
    expect(isIndexable(s, 'chapter', {})).toBe(false)
    expect(isIndexable(s, 'profile', {})).toBe(false)
    expect(isIndexable(s, 'search', {})).toBe(false)
    expect(isIndexable(s, 'browse', { hasFilters: true })).toBe(false)
    expect(isIndexable(s, 'browse', {})).toBe(true)
    expect(isIndexable(s, 'series', { noindex: true })).toBe(false)
    expect(isIndexable(s, 'series', {})).toBe(true)
    const off = settings({
      indexing: { site: false, chapters: true, profiles: true, browse_filters: true },
    })
    expect(isIndexable(off, 'home', {})).toBe(false)
    const meta = metadataFor(off, env, 'home', { path: '/' })
    expect(meta.robots).toEqual({ index: false, follow: true })
  })

  it('honours the canonical override, the custom feed URL and drops feeds when disabled', () => {
    const custom = settings({
      feeds: {
        enabled: true,
        custom_url: 'https://feeds.example.com/pal',
        items: 50,
        include_early_access: false,
      },
    })
    const meta = metadataFor(custom, env, 'series', {
      path: '/series/x',
      vars: { title: 'X' },
      canonical: 'https://primary.example.com/series/x',
      feed: '/series/x/feed',
    })
    expect(meta.alternates?.canonical).toBe('https://primary.example.com/series/x')
    const types = meta.alternates?.types as Record<string, { url: string }[]>
    expect(types['application/rss+xml']?.[0]?.url).toBe('https://feeds.example.com/pal')
    expect(types['application/atom+xml']).toBeUndefined()

    const off = settings({
      feeds: { enabled: false, custom_url: null, items: 50, include_early_access: false },
    })
    const none = metadataFor(off, env, 'series', { path: '/series/x', feed: '/series/x/feed' })
    expect(none.alternates?.types).toBeUndefined()
  })

  it('emits verification tags and chapter prev/next', () => {
    const s = settings({
      verification: { google: 'g123', bing: 'b456', yandex: null, pinterest: null },
    })
    const meta = metadataFor(s, env, 'chapter', {
      path: '/series/x/chapter-2',
      vars: { title: 'X', chapter: '2', next_prev_hint: '' },
      prev: '/series/x/chapter-1',
      next: '/series/x/chapter-3',
    })
    expect(meta.verification).toEqual({ google: 'g123', other: { 'msvalidate.01': 'b456' } })
    expect(meta.pagination).toEqual({
      previous: 'https://palscans.org/series/x/chapter-1',
      next: 'https://palscans.org/series/x/chapter-3',
    })
    expect((meta.openGraph as { type: string }).type).toBe('article')
  })
})
