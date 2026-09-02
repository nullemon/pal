import { gunzipSync, gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { atomXml, type FeedItem, rssXml } from './feeds'
import { submitIndexNow } from './indexnow'
import { EMPTY_SNAPSHOT, type ProxySnapshot, resolveProxy } from './proxy'
import { AI_CRAWLERS, DEFAULT_ROBOTS, robotsTxt } from './robots'
import { DEFAULT_SEO_SETTINGS, parseSeoSetting, type SeoSettings } from './settings'
import { normalisePath } from './urls'
import { chunk, esc, sitemapIndexXml, urlsetXml } from './xml'

const settings = (patch: Partial<SeoSettings> = {}): SeoSettings => ({
  ...DEFAULT_SEO_SETTINGS,
  ...patch,
})

describe('robots.txt (docs/12 §5, §8)', () => {
  it('uses the default with the sitemap line', () => {
    const txt = robotsTxt(settings(), 'https://palscans.org')
    expect(txt.startsWith(DEFAULT_ROBOTS)).toBe(true)
    expect(txt).toContain('Sitemap: https://palscans.org/sitemap.xml')
    expect(txt).not.toContain('GPTBot')
  })
  it('appends the AI preset and honours the custom sitemap URL', () => {
    const txt = robotsTxt(
      settings({
        robots: { custom: 'User-agent: *\nDisallow: /private', disallow_ai: true },
        sitemap: { ...DEFAULT_SEO_SETTINGS.sitemap, custom_url: 'https://cdn.example.com/s.xml' },
      }),
      'https://palscans.org',
    )
    expect(txt).toContain('Disallow: /private')
    for (const ua of AI_CRAWLERS) expect(txt).toContain(`User-agent: ${ua}`)
    expect(txt).toContain('Sitemap: https://cdn.example.com/s.xml')
    expect(txt).not.toContain('palscans.org/sitemap.xml')
  })
  it('drops the sitemap line when the sitemap is disabled', () => {
    const txt = robotsTxt(
      settings({ sitemap: { ...DEFAULT_SEO_SETTINGS.sitemap, enabled: false } }),
      'https://palscans.org',
    )
    expect(txt).not.toContain('Sitemap:')
  })
})

describe('sitemap XML', () => {
  it('escapes, emits lastmod and image extensions', () => {
    const xml = urlsetXml([
      { loc: 'https://p.org/series/a&b', lastmod: new Date('2026-02-03T04:05:06Z') },
      {
        loc: 'https://p.org/series/c',
        images: [{ url: 'https://p.org/_storage/covers/c.svg', title: 'C <cover>' }],
      },
    ])
    expect(xml).toContain('<loc>https://p.org/series/a&amp;b</loc>')
    expect(xml).toContain('<lastmod>2026-02-03T04:05:06.000Z</lastmod>')
    expect(xml).toContain('xmlns:image=')
    expect(xml).toContain('<image:title>C &lt;cover&gt;</image:title>')
    expect(xml).not.toContain('changefreq')
  })
  it('builds an index and chunks files', () => {
    const idx = sitemapIndexXml([{ loc: 'https://p.org/sitemaps/series-1.xml.gz' }])
    expect(idx).toContain('<sitemapindex')
    expect(idx).toContain('<loc>https://p.org/sitemaps/series-1.xml.gz</loc>')
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(esc('a\u0001b')).toBe('ab')
  })
  it('round-trips through gzip', () => {
    const xml = urlsetXml([{ loc: 'https://p.org/' }])
    expect(gunzipSync(gzipSync(Buffer.from(xml))).toString()).toBe(xml)
  })
})

describe('feeds (docs/12 §6)', () => {
  const channel = {
    title: 'PALScans — Latest chapters',
    description: 'New chapters',
    link: 'https://p.org/',
    self: 'https://p.org/feed',
  }
  const items: FeedItem[] = [
    {
      id: 'https://p.org/series/x/chapter-2',
      title: 'X Chapter 2',
      url: 'https://p.org/series/x/chapter-2',
      date: new Date('2026-05-01T10:00:00Z'),
      summary: 'Chapter 2 of X',
      categories: ['X', 'Manhwa'],
      enclosure: { url: 'https://p.org/_storage/covers/x.svg', type: 'image/svg+xml' },
    },
  ]
  it('renders RSS 2.0 with enclosure and pubDate', () => {
    const xml = rssXml(channel, items)
    expect(xml).toContain('<rss version="2.0"')
    expect(xml).toContain('<pubDate>Fri, 01 May 2026 10:00:00 GMT</pubDate>')
    expect(xml).toContain(
      '<enclosure url="https://p.org/_storage/covers/x.svg" type="image/svg+xml" length="0"/>',
    )
    expect(xml).toContain('<guid isPermaLink="true">https://p.org/series/x/chapter-2</guid>')
    expect(xml).toContain('<atom:link href="https://p.org/feed" rel="self"')
  })
  it('renders Atom', () => {
    const xml = atomXml(channel, items)
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">')
    expect(xml).toContain('<updated>2026-05-01T10:00:00.000Z</updated>')
    expect(xml).toContain('<link rel="enclosure" href="https://p.org/_storage/covers/x.svg"')
    expect(xml).toContain('<category term="Manhwa"/>')
  })
})

describe('proxy rules (docs/12 §1, §7, §10)', () => {
  const snap: ProxySnapshot = {
    ...EMPTY_SNAPSHOT,
    canonicalHost: 'palscans.org',
    redirects: {
      '/manga/old': { to: '/series/new', status: 301 },
      '/x': { to: 'https://e.com/', status: 302 },
    },
    slugs: { series: { 'old-name': 'new-name' }, genre: { act: 'action' }, announcement: {} },
    gone: ['removed-title'],
    indexnowKey: 'abc12345',
  }
  const url = (s: string) => new URL(s)

  it('301s www to apex keeping path and query', () => {
    const d = resolveProxy(snap, url('http://www.palscans.org/series/a?x=1'))
    expect(d).toEqual({
      kind: 'redirect',
      location: 'https://palscans.org/series/a?x=1',
      status: 301,
    })
  })
  it('strips trailing slashes', () => {
    expect(normalisePath('/series/a/')).toBe('/series/a')
    expect(normalisePath('/')).toBe('/')
    const d = resolveProxy(snap, url('https://palscans.org/series/a/?p=2'))
    expect(d).toEqual({ kind: 'redirect', location: '/series/a?p=2', status: 301 })
  })
  it('serves the IndexNow key file', () => {
    expect(resolveProxy(snap, url('https://palscans.org/abc12345.txt'))).toEqual({
      kind: 'text',
      body: 'abc12345',
    })
  })
  it('applies the redirects table with hit tracking', () => {
    expect(resolveProxy(snap, url('https://palscans.org/manga/old?ref=1'))).toEqual({
      kind: 'redirect',
      location: '/series/new?ref=1',
      status: 301,
      hit: '/manga/old',
    })
    expect(resolveProxy(snap, url('https://palscans.org/x'))).toMatchObject({
      location: 'https://e.com/',
      status: 302,
    })
  })
  it('301s old slugs (also chapter URLs) and 410s removed series', () => {
    expect(resolveProxy(snap, url('https://palscans.org/series/Old-Name/chapter-3'))).toEqual({
      kind: 'redirect',
      location: '/series/new-name/chapter-3',
      status: 301,
    })
    expect(resolveProxy(snap, url('https://palscans.org/genres/act'))).toMatchObject({
      location: '/genres/action',
    })
    expect(resolveProxy(snap, url('https://palscans.org/series/removed-title'))).toEqual({
      kind: 'gone',
      slug: 'removed-title',
    })
  })
  it('passes through with X-Robots-Tag when the site is not indexable', () => {
    expect(resolveProxy(snap, url('https://palscans.org/series/new-name'))).toEqual({
      kind: 'next',
      headers: {},
    })
    expect(resolveProxy({ ...snap, indexable: false }, url('https://palscans.org/browse'))).toEqual(
      {
        kind: 'next',
        headers: { 'x-robots-tag': 'noindex, nofollow' },
      },
    )
  })
})

describe('settings parsing', () => {
  it('falls back field by field', () => {
    const s = parseSeoSetting('sitemap', {
      enabled: 'yes',
      chapters_per_file: 5,
      custom_url: 'nope',
    })
    expect(s.enabled).toBe(true)
    expect(s.chapters_per_file).toBe(20_000)
    expect(s.custom_url).toBeNull()
    expect(parseSeoSetting('identity', null).site_name).toBe('PALScans')
  })
})

describe('IndexNow', () => {
  it('posts the url list with host and key location', async () => {
    let sent: { url: string; body: string } | undefined
    const fetchImpl: typeof fetch = async (input, init) => {
      sent = { url: String(input), body: String(init?.body) }
      return new Response('', { status: 202 })
    }
    const r = await submitIndexNow({
      siteUrl: 'https://palscans.org',
      key: 'k1',
      urls: ['https://palscans.org/series/a', 'https://palscans.org/series/a'],
      fetchImpl,
    })
    expect(r).toEqual({ submitted: 1, status: 202, ok: true })
    expect(sent?.url).toBe('https://api.indexnow.org/indexnow')
    expect(JSON.parse(sent?.body ?? '{}')).toEqual({
      host: 'palscans.org',
      key: 'k1',
      keyLocation: 'https://palscans.org/k1.txt',
      urlList: ['https://palscans.org/series/a'],
    })
  })
  it('never throws', async () => {
    const r = await submitIndexNow({
      siteUrl: 'https://palscans.org',
      key: 'k1',
      urls: ['https://palscans.org/'],
      fetchImpl: async () => {
        throw new Error('offline')
      },
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('offline')
  })
})
