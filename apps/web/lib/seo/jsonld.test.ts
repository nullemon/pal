import { describe, expect, it } from 'vitest'
import {
  articleJsonLd,
  breadcrumbJsonLd,
  comicIssueJsonLd,
  comicSeriesJsonLd,
  extractJsonLd,
  faqPageJsonLd,
  graphJsonLd,
  itemListJsonLd,
  jsonLdTypes,
  organizationJsonLd,
  serializeJsonLd,
  validateJsonLd,
  webSiteJsonLd,
} from './jsonld'

const ORIGIN = 'https://palscans.org'

describe('JSON-LD builders (docs/12 §4)', () => {
  it('Organization carries sameAs and validates', () => {
    const node = organizationJsonLd({
      name: 'PALScans',
      url: ORIGIN,
      sameAs: ['https://x.com/palscans', 'https://discord.gg/palscans'],
    })
    expect(node['@type']).toBe('Organization')
    expect(node.sameAs).toHaveLength(2)
    expect(validateJsonLd(node).ok).toBe(true)
  })

  it('WebSite has a SearchAction pointing at /search?q=', () => {
    const node = webSiteJsonLd({ name: 'PALScans', url: ORIGIN })
    const action = node.potentialAction as { target: { urlTemplate: string } }
    expect(action.target.urlTemplate).toBe(`${ORIGIN}/search?q={search_term_string}`)
    expect(validateJsonLd(node).ok).toBe(true)
  })

  it('BreadcrumbList positions are sequential and absolute', () => {
    const node = breadcrumbJsonLd([
      { name: 'Home', url: `${ORIGIN}/` },
      { name: 'Series', url: `${ORIGIN}/browse` },
      { name: 'Solo Leveling', url: `${ORIGIN}/series/solo-leveling` },
    ])
    const items = node.itemListElement as { position: number }[]
    expect(items.map((i) => i.position)).toEqual([1, 2, 3])
    expect(validateJsonLd(node).ok).toBe(true)
  })

  it('ComicSeries uses the real rating count and rounds the value', () => {
    const node = comicSeriesJsonLd({
      name: 'Return of the Frost Monarch',
      url: `${ORIGIN}/series/return-of-the-frost-monarch`,
      alternateNames: ['서리 군주의 귀환'],
      authors: ['Kim'],
      illustrators: ['Lee'],
      genres: ['Action', 'Fantasy'],
      numberOfEpisodes: 301,
      datePublished: 2021,
      image: `${ORIGIN}/_storage/covers/x.svg`,
      publisher: { name: 'PALScans', url: ORIGIN },
      rating: { value: 9.26, count: 1284 },
    })
    const rating = node.aggregateRating as { ratingValue: number; ratingCount: number }
    expect(rating.ratingValue).toBe(9.3)
    expect(rating.ratingCount).toBe(1284)
    expect(node.datePublished).toBe('2021')
    expect(validateJsonLd(node).ok).toBe(true)
  })

  it('ComicSeries omits aggregateRating when nobody rated', () => {
    const node = comicSeriesJsonLd({
      name: 'X',
      url: `${ORIGIN}/series/x`,
      numberOfEpisodes: 0,
      publisher: { name: 'PALScans', url: ORIGIN },
      rating: { value: 0, count: 0 },
    })
    expect(node.aggregateRating).toBeUndefined()
    expect(node.alternateName).toBeUndefined()
  })

  it('ComicIssue is part of its series', () => {
    const node = comicIssueJsonLd({
      url: `${ORIGIN}/series/x/chapter-12.5`,
      issueNumber: 12.5,
      name: 'Chapter 12.5',
      series: { name: 'X', url: `${ORIGIN}/series/x` },
      datePublished: new Date('2026-01-02T03:04:05Z'),
      image: `${ORIGIN}/_storage/pages/p.svg`,
    })
    expect(node.issueNumber).toBe('12.5')
    expect(node.datePublished).toBe('2026-01-02T03:04:05.000Z')
    expect(validateJsonLd(node).ok).toBe(true)
  })

  it('ItemList + FAQPage validate', () => {
    const list = itemListJsonLd('Top Action', [
      { name: 'A', url: `${ORIGIN}/series/a` },
      { name: 'B', url: `${ORIGIN}/series/b` },
    ])
    const faq = faqPageJsonLd([{ q: 'What is manhwa?', a: 'Korean comics.' }])
    expect(validateJsonLd([list, faq]).ok).toBe(true)
    expect(list.numberOfItems).toBe(2)
  })

  it('Article requires an image and caps the headline', () => {
    const base = {
      url: `${ORIGIN}/announcements/welcome`,
      headline: 'x'.repeat(200),
      datePublished: '2026-01-01T00:00:00Z',
      author: { name: 'admin' },
      publisher: { name: 'PALScans', url: ORIGIN },
    }
    const without = articleJsonLd(base)
    expect(String(without.headline)).toHaveLength(110)
    expect(validateJsonLd(without).ok).toBe(false)
    const withImage = articleJsonLd({ ...base, image: `${ORIGIN}/og.png` })
    expect(validateJsonLd(withImage).ok).toBe(true)
  })

  it('graphJsonLd folds contexts into one @graph and the validator walks it', () => {
    const graph = graphJsonLd([
      organizationJsonLd({ name: 'P', url: ORIGIN }),
      webSiteJsonLd({ name: 'P', url: ORIGIN }),
    ])
    expect(graph['@context']).toBe('https://schema.org')
    expect((graph['@graph'] as unknown[]).length).toBe(2)
    expect(validateJsonLd(graph).ok).toBe(true)
    expect(jsonLdTypes(graph)).toEqual(
      expect.arrayContaining(['Organization', 'WebSite', 'SearchAction']),
    )
  })

  it('reports missing fields and bad ratings', () => {
    const bad = {
      '@context': 'https://schema.org',
      '@type': 'ComicSeries',
      name: 'X',
      aggregateRating: { '@type': 'AggregateRating', ratingValue: 11, ratingCount: 0 },
    }
    const result = validateJsonLd(bad)
    expect(result.ok).toBe(false)
    expect(result.issues.map((i) => i.field)).toEqual(
      expect.arrayContaining(['url', 'ratingValue', 'ratingCount']),
    )
  })

  it('accepts nested arrays of scripts and nested workExample issues', () => {
    const series = comicSeriesJsonLd({
      name: 'X',
      url: `${ORIGIN}/series/x`,
      numberOfEpisodes: 3,
      publisher: { name: 'P', url: ORIGIN },
    })
    series.workExample = { '@type': 'ComicIssue', issueNumber: 3 }
    const crumbs = breadcrumbJsonLd([{ name: 'Home', url: `${ORIGIN}/` }])
    expect(
      validateJsonLd([[crumbs, series], organizationJsonLd({ name: 'P', url: ORIGIN })]).ok,
    ).toBe(true)
  })

  it('serialises without a closing tag hazard and extracts from HTML', () => {
    const json = serializeJsonLd({ name: '</script><b>' })
    expect(json).not.toContain('</script>')
    const html = `<html><head><script type="application/ld+json">${json}</script><script type="application/ld+json">{bad</script></head></html>`
    const out = extractJsonLd(html)
    expect(out.parsed).toEqual([{ name: '</script><b>' }])
    expect(out.errors).toHaveLength(1)
  })
})
