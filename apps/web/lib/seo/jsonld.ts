/**
 * Typed JSON-LD builders (docs/12 §4). One `<script type="application/ld+json">` per page,
 * built from database values so the shape cannot drift. `validateJsonLd` runs the same
 * required-field checks the admin "Validate" tool and the unit tests use.
 */

export type JsonLdNode = Record<string, unknown>

const CONTEXT = 'https://schema.org'

const compact = (node: JsonLdNode): JsonLdNode => {
  const out: JsonLdNode = {}
  for (const [k, v] of Object.entries(node)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return out
}

export interface OrganizationInput {
  name: string
  url: string
  logo?: string | null
  sameAs?: readonly string[]
}

export const organizationJsonLd = (input: OrganizationInput): JsonLdNode =>
  compact({
    '@context': CONTEXT,
    '@type': 'Organization',
    '@id': `${input.url.replace(/\/$/, '')}/#organization`,
    name: input.name,
    url: input.url,
    logo: input.logo ?? undefined,
    sameAs: input.sameAs ? [...input.sameAs] : undefined,
  })

export interface WebSiteInput {
  name: string
  url: string
  /** Search results path; `{search_term_string}` is appended as `?q=`. */
  searchPath?: string
}

export const webSiteJsonLd = (input: WebSiteInput): JsonLdNode => {
  const origin = input.url.replace(/\/$/, '')
  return {
    '@context': CONTEXT,
    '@type': 'WebSite',
    '@id': `${origin}/#website`,
    name: input.name,
    url: `${origin}/`,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${origin}${input.searchPath ?? '/search'}?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  }
}

export interface BreadcrumbItem {
  name: string
  url: string
}

export const breadcrumbJsonLd = (items: readonly BreadcrumbItem[]): JsonLdNode => ({
  '@context': CONTEXT,
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: item.name,
    item: item.url,
  })),
})

export interface ComicSeriesInput {
  name: string
  url: string
  alternateNames?: readonly string[]
  description?: string | null
  image?: string | null
  authors?: readonly string[]
  illustrators?: readonly string[]
  genres?: readonly string[]
  numberOfEpisodes: number
  datePublished?: string | number | null
  publisher: { name: string; url: string }
  /** Real ratings only — never bookmarks (docs/12 §4). */
  rating?: { value: number; count: number } | null
}

export const comicSeriesJsonLd = (input: ComicSeriesInput): JsonLdNode => {
  const persons = (names: readonly string[] | undefined) =>
    names?.map((name) => ({ '@type': 'Person', name }))
  const node = compact({
    '@context': CONTEXT,
    '@type': 'ComicSeries',
    '@id': input.url,
    name: input.name,
    url: input.url,
    alternateName: input.alternateNames ? [...input.alternateNames] : undefined,
    description: input.description ?? undefined,
    image: input.image ?? undefined,
    author: persons(input.authors),
    illustrator: persons(input.illustrators),
    genre: input.genres ? [...input.genres] : undefined,
    numberOfEpisodes: input.numberOfEpisodes,
    datePublished: input.datePublished == null ? undefined : String(input.datePublished),
    publisher: { '@type': 'Organization', name: input.publisher.name, url: input.publisher.url },
  })
  if (input.rating && input.rating.count > 0) {
    node.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Math.round(input.rating.value * 10) / 10,
      bestRating: 10,
      worstRating: 1,
      ratingCount: input.rating.count,
    }
  }
  return node
}

export interface ComicIssueInput {
  url: string
  issueNumber: string | number
  name: string
  series: { name: string; url: string }
  datePublished?: Date | string | null
  /** The first page, or the cover when the viewer may not read the chapter. */
  image?: string | null
}

export const comicIssueJsonLd = (input: ComicIssueInput): JsonLdNode =>
  compact({
    '@context': CONTEXT,
    '@type': 'ComicIssue',
    '@id': input.url,
    url: input.url,
    issueNumber: String(input.issueNumber),
    name: input.name,
    isPartOf: { '@type': 'ComicSeries', name: input.series.name, url: input.series.url },
    datePublished:
      input.datePublished instanceof Date
        ? input.datePublished.toISOString()
        : (input.datePublished ?? undefined),
    image: input.image ?? undefined,
  })

export interface ItemListEntry {
  name: string
  url: string
}

export const itemListJsonLd = (name: string, items: readonly ItemListEntry[]): JsonLdNode => ({
  '@context': CONTEXT,
  '@type': 'ItemList',
  name,
  numberOfItems: items.length,
  itemListElement: items.map((item, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: item.name,
    url: item.url,
  })),
})

export interface FaqEntryInput {
  q: string
  a: string
}

export const faqPageJsonLd = (entries: readonly FaqEntryInput[]): JsonLdNode => ({
  '@context': CONTEXT,
  '@type': 'FAQPage',
  mainEntity: entries.map((e) => ({
    '@type': 'Question',
    name: e.q,
    acceptedAnswer: { '@type': 'Answer', text: e.a },
  })),
})

export interface ArticleInput {
  url: string
  headline: string
  description?: string | null
  datePublished: Date | string
  dateModified?: Date | string | null
  author: { name: string; url?: string }
  publisher: { name: string; url: string; logo?: string | null }
  image?: string | null
}

const iso = (d: Date | string | null | undefined): string | undefined =>
  d == null ? undefined : d instanceof Date ? d.toISOString() : d

export const articleJsonLd = (input: ArticleInput): JsonLdNode =>
  compact({
    '@context': CONTEXT,
    '@type': 'Article',
    '@id': input.url,
    mainEntityOfPage: input.url,
    url: input.url,
    headline: input.headline.slice(0, 110),
    description: input.description ?? undefined,
    datePublished: iso(input.datePublished),
    dateModified: iso(input.dateModified) ?? iso(input.datePublished),
    author: compact({ '@type': 'Person', name: input.author.name, url: input.author.url }),
    publisher: compact({
      '@type': 'Organization',
      name: input.publisher.name,
      url: input.publisher.url,
      logo: input.publisher.logo
        ? { '@type': 'ImageObject', url: input.publisher.logo }
        : undefined,
    }),
    image: input.image ?? undefined,
  })

/** Several nodes in one script: a `@graph` under a single context. */
export const graphJsonLd = (nodes: readonly JsonLdNode[]): JsonLdNode => ({
  '@context': CONTEXT,
  '@graph': nodes.map((n) => {
    const { '@context': _ctx, ...rest } = n
    return rest
  }),
})

/** `<` is escaped so a title can never close the script element. */
export const serializeJsonLd = (data: unknown): string =>
  JSON.stringify(data).replace(/</g, '\\u003c')

// ---- validation (docs/12 §4: "unit-tested against Google's Rich Results schema") --------

export interface JsonLdIssue {
  type: string
  field: string
  message: string
}

const REQUIRED: Record<string, readonly string[]> = {
  Organization: ['name', 'url'],
  WebSite: ['name', 'url', 'potentialAction'],
  BreadcrumbList: ['itemListElement'],
  ComicSeries: ['name', 'url'],
  ComicIssue: ['issueNumber', 'name', 'isPartOf'],
  ItemList: ['itemListElement'],
  FAQPage: ['mainEntity'],
  Article: ['headline', 'datePublished', 'author', 'image'],
  ListItem: ['position'],
  Question: ['name', 'acceptedAnswer'],
  AggregateRating: ['ratingValue', 'ratingCount'],
}

const isRecord = (v: unknown): v is JsonLdNode => typeof v === 'object' && v !== null

const isAbsoluteUrl = (v: unknown): boolean => typeof v === 'string' && /^https?:\/\//.test(v)

/** Types whose required fields only apply at the top level (nested `workExample` issues are fine). */
const TOP_LEVEL_ONLY = new Set(['ComicIssue', 'ComicSeries'])

function checkNode(node: JsonLdNode, issues: JsonLdIssue[], path: string, top = true): void {
  const type = typeof node['@type'] === 'string' ? node['@type'] : null
  if (type) {
    const required = !top && TOP_LEVEL_ONLY.has(type) ? [] : (REQUIRED[type] ?? [])
    for (const field of required) {
      const v = node[field]
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
        issues.push({ type, field, message: `${type} is missing required field "${field}"` })
      }
    }
    if (type === 'ListItem') {
      if (typeof node.position !== 'number' || node.position < 1)
        issues.push({ type, field: 'position', message: 'ListItem.position must be >= 1' })
      if (!node.item && !node.url)
        issues.push({ type, field: 'item', message: 'ListItem needs an item or a url' })
      if (typeof node.item === 'string' && !isAbsoluteUrl(node.item))
        issues.push({ type, field: 'item', message: 'ListItem.item must be an absolute URL' })
    }
    if (type === 'AggregateRating') {
      const value = Number(node.ratingValue)
      const count = Number(node.ratingCount)
      if (!Number.isFinite(value) || value < 1 || value > 10)
        issues.push({ type, field: 'ratingValue', message: 'ratingValue must be between 1 and 10' })
      if (!Number.isInteger(count) || count < 1)
        issues.push({
          type,
          field: 'ratingCount',
          message: 'ratingCount must be a positive integer',
        })
    }
    if (type === 'Article' && typeof node.headline === 'string' && node.headline.length > 110)
      issues.push({ type, field: 'headline', message: 'headline should be at most 110 characters' })
    if (
      (type === 'Article' || type === 'ComicIssue' || type === 'ComicSeries') &&
      node.image !== undefined &&
      !isAbsoluteUrl(node.image)
    )
      issues.push({ type, field: 'image', message: 'image must be an absolute URL' })
    if (type === 'BreadcrumbList' && Array.isArray(node.itemListElement)) {
      const positions = node.itemListElement
        .filter(isRecord)
        .map((n) => n.position)
        .filter((p): p is number => typeof p === 'number')
      if (positions.some((p, i) => p !== i + 1))
        issues.push({
          type,
          field: 'itemListElement',
          message: 'positions must be sequential from 1',
        })
    }
    for (const field of ['url', '@id', 'item']) {
      if (node[field] !== undefined && !isAbsoluteUrl(node[field]) && field !== 'item')
        issues.push({ type, field, message: `${field} must be an absolute URL` })
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === '@context') continue
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (isRecord(v)) checkNode(v, issues, `${path}.${key}[${i}]`, false)
      })
    } else if (isRecord(value)) checkNode(value, issues, `${path}.${key}`, false)
  }
}

/** Required-field check for the node types we emit; nested nodes and `@graph` included. */
export function validateJsonLd(data: unknown): { ok: boolean; issues: JsonLdIssue[] } {
  const issues: JsonLdIssue[] = []
  // A page may carry several scripts, and a script may itself be an array of nodes.
  const roots = (Array.isArray(data) ? data : [data]).flat(3)
  for (const root of roots) {
    if (!isRecord(root)) {
      issues.push({ type: 'root', field: '', message: 'JSON-LD must be an object' })
      continue
    }
    if (root['@context'] !== CONTEXT && !('@graph' in root && root['@context']))
      issues.push({
        type: 'root',
        field: '@context',
        message: '@context must be https://schema.org',
      })
    if (Array.isArray(root['@graph'])) {
      for (const n of root['@graph']) if (isRecord(n)) checkNode(n, issues, '@graph')
    } else checkNode(root, issues, '$')
  }
  return { ok: issues.length === 0, issues }
}

/** The types present in a document, for the validator's report. */
export function jsonLdTypes(data: unknown): string[] {
  const types = new Set<string>()
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!isRecord(node)) return
    if (typeof node['@type'] === 'string') types.add(node['@type'])
    for (const v of Object.values(node)) walk(v)
  }
  walk(data)
  return [...types]
}

/** Pull every `application/ld+json` block out of an HTML document. */
export function extractJsonLd(html: string): { parsed: unknown[]; errors: string[] } {
  const parsed: unknown[] = []
  const errors: string[] = []
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  for (const m of html.matchAll(re)) {
    const raw = (m[1] ?? '').trim()
    if (!raw) continue
    try {
      parsed.push(JSON.parse(raw))
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'invalid JSON')
    }
  }
  return { parsed, errors }
}
