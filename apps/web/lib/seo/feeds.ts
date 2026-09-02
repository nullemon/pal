import { esc, isoDate } from './xml'

/**
 * RSS 2.0 and Atom builders (docs/12 §6). Items carry the chapter title, series, cover as an
 * enclosure and `pubDate` from `published_at`. Pure functions — the route handlers load
 * data and pick the format.
 */

export type FeedFormat = 'rss' | 'atom'

export const parseFeedFormat = (value: string | null | undefined): FeedFormat =>
  value === 'atom' ? 'atom' : 'rss'

export interface FeedEnclosure {
  url: string
  type: string
  length?: number
}

export interface FeedItem {
  /** Stable id; the item URL is a fine choice. */
  id: string
  title: string
  url: string
  date: Date | string
  summary?: string | null
  author?: string | null
  categories?: readonly string[]
  enclosure?: FeedEnclosure | null
}

export interface FeedChannel {
  title: string
  description: string
  /** The page the feed describes. */
  link: string
  /** The feed's own URL (`atom:link rel=self`). */
  self: string
  language?: string
  updated?: Date | string | null
}

const rfc822 = (d: Date | string): string => {
  const date = d instanceof Date ? d : new Date(d)
  return Number.isNaN(date.getTime()) ? new Date(0).toUTCString() : date.toUTCString()
}

export const FEED_CACHE_CONTROL = 'public, max-age=300, s-maxage=300, stale-while-revalidate=60'

export function rssXml(channel: FeedChannel, items: readonly FeedItem[]): string {
  const latest = channel.updated ?? items[0]?.date ?? new Date()
  const entries = items.map((item) => {
    const parts = [
      `<title>${esc(item.title)}</title>`,
      `<link>${esc(item.url)}</link>`,
      `<guid isPermaLink="${item.id === item.url ? 'true' : 'false'}">${esc(item.id)}</guid>`,
      `<pubDate>${rfc822(item.date)}</pubDate>`,
    ]
    if (item.summary) parts.push(`<description>${esc(item.summary)}</description>`)
    if (item.author) parts.push(`<dc:creator>${esc(item.author)}</dc:creator>`)
    for (const c of item.categories ?? []) parts.push(`<category>${esc(c)}</category>`)
    if (item.enclosure)
      parts.push(
        `<enclosure url="${esc(item.enclosure.url)}" type="${esc(item.enclosure.type)}" length="${item.enclosure.length ?? 0}"/>`,
      )
    return `<item>${parts.join('')}</item>`
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '<channel>',
    `<title>${esc(channel.title)}</title>`,
    `<link>${esc(channel.link)}</link>`,
    `<description>${esc(channel.description)}</description>`,
    `<language>${esc(channel.language ?? 'en')}</language>`,
    `<lastBuildDate>${rfc822(latest)}</lastBuildDate>`,
    `<atom:link href="${esc(channel.self)}" rel="self" type="application/rss+xml"/>`,
    ...entries,
    '</channel>',
    '</rss>',
    '',
  ].join('\n')
}

export function atomXml(channel: FeedChannel, items: readonly FeedItem[]): string {
  const latest = channel.updated ?? items[0]?.date ?? new Date()
  const entries = items.map((item) => {
    const stamp = isoDate(item.date) ?? new Date(0).toISOString()
    const parts = [
      `<title>${esc(item.title)}</title>`,
      `<link rel="alternate" href="${esc(item.url)}"/>`,
      `<id>${esc(item.id.startsWith('http') ? item.id : `urn:palscans:${item.id}`)}</id>`,
      `<updated>${stamp}</updated>`,
      `<published>${stamp}</published>`,
    ]
    if (item.summary) parts.push(`<summary>${esc(item.summary)}</summary>`)
    if (item.author) parts.push(`<author><name>${esc(item.author)}</name></author>`)
    for (const c of item.categories ?? []) parts.push(`<category term="${esc(c)}"/>`)
    if (item.enclosure)
      parts.push(
        `<link rel="enclosure" href="${esc(item.enclosure.url)}" type="${esc(item.enclosure.type)}"${
          item.enclosure.length ? ` length="${item.enclosure.length}"` : ''
        }/>`,
      )
    return `<entry>${parts.join('')}</entry>`
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `<title>${esc(channel.title)}</title>`,
    `<subtitle>${esc(channel.description)}</subtitle>`,
    `<link rel="alternate" href="${esc(channel.link)}"/>`,
    `<link rel="self" href="${esc(channel.self)}"/>`,
    `<id>${esc(channel.self)}</id>`,
    `<updated>${isoDate(latest) ?? new Date().toISOString()}</updated>`,
    ...entries,
    '</feed>',
    '',
  ].join('\n')
}

export const feedContentType = (format: FeedFormat): string =>
  format === 'atom' ? 'application/atom+xml; charset=utf-8' : 'application/rss+xml; charset=utf-8'

/** Build the response for a feed in the requested format. */
export function feedResponse(
  format: FeedFormat,
  channel: FeedChannel,
  items: readonly FeedItem[],
): Response {
  const body = format === 'atom' ? atomXml(channel, items) : rssXml(channel, items)
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': feedContentType(format),
      'cache-control': FEED_CACHE_CONTROL,
      'x-content-type-options': 'nosniff',
    },
  })
}
