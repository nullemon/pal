import { formatChapterNumber } from '@palscans/core'
import { fmt, messages } from '@palscans/core/messages'
import {
  announcements,
  chapters,
  type Db,
  genres,
  getDb,
  series,
  seriesGenres,
  users,
} from '@palscans/db'
import { and, desc, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { getEnv } from '../env'
import { type FeedChannel, type FeedItem, feedResponse, parseFeedFormat } from './feeds'
import { cachedSeoSettings, type SeoSettings } from './settings'
import { announcementPath, chapterPath, genrePath, seriesPath, storagePublicUrl } from './urls'

/**
 * Data behind the feed routes (docs/12 §6). Every loader returns plain `FeedItem`s; the
 * route picks RSS or Atom. Locked chapters (early access, premium) are left out unless the
 * admin turned "Include early-access chapters" on — they appear when they become free.
 */

const coverType = (key: string | null): string => {
  const ext = key?.split('.').pop()?.toLowerCase()
  if (ext === 'svg') return 'image/svg+xml'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'avif') return 'image/avif'
  if (ext === 'png') return 'image/png'
  return 'image/jpeg'
}

const enclosureFor = (key: string | null) => {
  const url = storagePublicUrl(key)
  return url ? { url, type: coverType(key) } : null
}

const chapterVisible = (settings: SeoSettings, now: Date) =>
  settings.feeds.include_early_access
    ? sql`true`
    : and(
        eq(chapters.isPremium, false),
        or(isNull(chapters.earlyAccessUntil), lte(chapters.earlyAccessUntil, now)),
      )

const chapterColumns = {
  id: chapters.id,
  number: chapters.number,
  title: chapters.title,
  publishedAt: chapters.publishedAt,
  seriesSlug: series.slug,
  seriesTitle: series.title,
  seriesType: series.type,
  coverKey: series.coverKey,
} as const

type ChapterFeedRow = {
  id: number
  number: number
  title: string | null
  publishedAt: Date | null
  seriesSlug: string
  seriesTitle: string
  seriesType: (typeof series.$inferSelect)['type']
  coverKey: string | null
}

const chapterItem = (origin: string, c: ChapterFeedRow): FeedItem => {
  const n = formatChapterNumber(c.number)
  const url = `${origin}${chapterPath(c.seriesSlug, c.number)}`
  const date = c.publishedAt ?? new Date(0)
  return {
    id: url,
    title: c.title
      ? fmt(messages.seo.feed.chapterItemTitled, { title: c.seriesTitle, n, chapterTitle: c.title })
      : fmt(messages.seo.feed.chapterItem, { title: c.seriesTitle, n }),
    url,
    date,
    summary: fmt(messages.seo.feed.chapterSummary, {
      n,
      title: c.seriesTitle,
      date: date.toISOString().slice(0, 10),
    }),
    categories: [c.seriesTitle, messages.series.type[c.seriesType]],
    enclosure: enclosureFor(c.coverKey),
  }
}

export async function siteChapterItems(db: Db, settings: SeoSettings, origin: string, now: Date) {
  const rows = await db
    .select(chapterColumns)
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(
      and(
        eq(chapters.state, 'published'),
        isNull(chapters.deletedAt),
        eq(series.state, 'published'),
        isNull(series.deletedAt),
        chapterVisible(settings, now),
      ),
    )
    .orderBy(desc(chapters.publishedAt), desc(chapters.id))
    .limit(settings.feeds.items)
  return rows.map((r) => chapterItem(origin, r))
}

export async function seriesChapterItems(
  db: Db,
  settings: SeoSettings,
  origin: string,
  now: Date,
  slug: string,
) {
  const [s] = await db
    .select({ id: series.id, slug: series.slug, title: series.title })
    .from(series)
    .where(and(eq(series.slug, slug), eq(series.state, 'published'), isNull(series.deletedAt)))
    .limit(1)
  if (!s) return null
  const rows = await db
    .select(chapterColumns)
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(
      and(
        eq(chapters.seriesId, s.id),
        eq(chapters.state, 'published'),
        isNull(chapters.deletedAt),
        chapterVisible(settings, now),
      ),
    )
    .orderBy(desc(chapters.publishedAt), desc(chapters.id))
    .limit(settings.feeds.items)
  return { series: s, items: rows.map((r) => chapterItem(origin, r)) }
}

export async function genreChapterItems(
  db: Db,
  settings: SeoSettings,
  origin: string,
  now: Date,
  slug: string,
) {
  const [g] = await db
    .select({ id: genres.id, slug: genres.slug, name: genres.name })
    .from(genres)
    .where(eq(genres.slug, slug))
    .limit(1)
  if (!g) return null
  const rows = await db
    .select(chapterColumns)
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .innerJoin(seriesGenres, eq(seriesGenres.seriesId, series.id))
    .where(
      and(
        eq(seriesGenres.genreId, g.id),
        eq(chapters.state, 'published'),
        isNull(chapters.deletedAt),
        eq(series.state, 'published'),
        isNull(series.deletedAt),
        chapterVisible(settings, now),
      ),
    )
    .orderBy(desc(chapters.publishedAt), desc(chapters.id))
    .limit(settings.feeds.items)
  return { genre: g, items: rows.map((r) => chapterItem(origin, r)) }
}

export async function newSeriesItems(db: Db, settings: SeoSettings, origin: string) {
  const rows = await db
    .select({
      slug: series.slug,
      title: series.title,
      type: series.type,
      synopsis: series.synopsis,
      coverKey: series.coverKey,
      publishedAt: series.publishedAt,
      createdAt: series.createdAt,
    })
    .from(series)
    .where(and(eq(series.state, 'published'), isNull(series.deletedAt)))
    .orderBy(desc(sql`coalesce(${series.publishedAt}, ${series.createdAt})`), desc(series.id))
    .limit(settings.feeds.items)
  const site = settings.identity.site_name
  return rows.map((r): FeedItem => {
    const url = `${origin}${seriesPath(r.slug)}`
    return {
      id: url,
      title: r.title,
      url,
      date: r.publishedAt ?? r.createdAt,
      summary:
        r.synopsis ??
        fmt(messages.seo.feed.newSeriesSummary, {
          title: r.title,
          type: messages.series.type[r.type],
          site,
        }),
      categories: [messages.series.type[r.type]],
      enclosure: enclosureFor(r.coverKey),
    }
  })
}

export async function announcementItems(db: Db, settings: SeoSettings, origin: string) {
  const rows = await db
    .select({
      slug: announcements.slug,
      title: announcements.title,
      excerpt: announcements.excerpt,
      coverKey: announcements.coverKey,
      publishedAt: announcements.publishedAt,
      tags: announcements.tags,
      author: users.username,
    })
    .from(announcements)
    .leftJoin(users, eq(users.id, announcements.authorId))
    .where(
      and(
        eq(announcements.state, 'published'),
        or(isNull(announcements.publishedAt), sql`${announcements.publishedAt} <= now()`),
      ),
    )
    .orderBy(desc(announcements.publishedAt), desc(announcements.id))
    .limit(settings.feeds.items)
  return rows.map((r): FeedItem => {
    const url = `${origin}${announcementPath(r.slug)}`
    return {
      id: url,
      title: r.title,
      url,
      date: r.publishedAt ?? new Date(0),
      summary: r.excerpt,
      author: r.author ?? settings.identity.site_name,
      categories: r.tags,
      enclosure: enclosureFor(r.coverKey),
    }
  })
}

// ---- route glue ------------------------------------------------------------------------

export type FeedKind =
  | { kind: 'site' }
  | { kind: 'new-series' }
  | { kind: 'series'; slug: string }
  | { kind: 'genre'; slug: string }
  | { kind: 'announcements' }

const notFound = () => Response.json({ error: 'not_found' }, { status: 404 })

/** Shared handler for every feed route: 404 when feeds are off or the entity is missing. */
export async function serveFeed(request: Request, feed: FeedKind): Promise<Response> {
  const settings = await cachedSeoSettings()
  if (!settings.feeds.enabled) return notFound()
  const url = new URL(request.url)
  const format = parseFeedFormat(url.searchParams.get('format'))
  const origin = new URL(getEnv().SITE_URL).origin
  const db = await getDb()
  const now = new Date()
  const site = settings.identity.site_name
  const self = `${origin}${url.pathname}${format === 'atom' ? '?format=atom' : ''}`
  const m = messages.seo.feed

  let channel: FeedChannel
  let items: FeedItem[]
  switch (feed.kind) {
    case 'site':
      channel = {
        title: `${site} — ${m.site}`,
        description: fmt(m.siteDescription, { site }),
        link: `${origin}/`,
        self,
      }
      items = await siteChapterItems(db, settings, origin, now)
      break
    case 'new-series':
      channel = {
        title: `${site} — ${m.newSeries}`,
        description: fmt(m.newSeriesDescription, { site }),
        link: `${origin}/browse?sort=newest`,
        self,
      }
      items = await newSeriesItems(db, settings, origin)
      break
    case 'series': {
      const result = await seriesChapterItems(db, settings, origin, now, feed.slug)
      if (!result) return notFound()
      channel = {
        title: fmt(m.series, { title: result.series.title }),
        description: fmt(m.seriesDescription, { title: result.series.title, site }),
        link: `${origin}${seriesPath(result.series.slug)}`,
        self,
      }
      items = result.items
      break
    }
    case 'genre': {
      const result = await genreChapterItems(db, settings, origin, now, feed.slug)
      if (!result) return notFound()
      channel = {
        title: fmt(m.genre, { genre: result.genre.name }),
        description: fmt(m.genreDescription, { genre: result.genre.name, site }),
        link: `${origin}${genrePath(result.genre.slug)}`,
        self,
      }
      items = result.items
      break
    }
    case 'announcements':
      channel = {
        title: `${site} — ${m.announcements}`,
        description: fmt(m.announcementsDescription, { site }),
        link: `${origin}/announcements`,
        self,
      }
      items = await announcementItems(db, settings, origin)
      break
  }
  return feedResponse(format, channel, items)
}

/** True when a chapter would show in a feed right now (for callers outside the routes). */
export const chapterInFeed = (
  settings: SeoSettings,
  chapter: { isPremium: boolean; earlyAccessUntil: Date | null },
  now: Date,
): boolean =>
  settings.feeds.include_early_access ||
  (!chapter.isPremium && (!chapter.earlyAccessUntil || chapter.earlyAccessUntil <= now))
