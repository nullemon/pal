import { formatChapterNumber, renderTemplate, type TemplateVars } from '@palscans/core'
import { messages } from '@palscans/core/messages'
import {
  announcements,
  chapters,
  type Db,
  genres,
  getSeoSetting,
  people,
  redirects,
  series,
  seriesGenres,
  seriesPeople,
} from '@palscans/db'
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { SeoSettings, SeoTemplates } from './settings'
import type { IndexNowLog } from './sitemaps'
import { INDEXNOW_LOG_KEY, recentSitemapBuilds } from './sitemaps'
import { announcementPath, chapterPath, genrePath, seriesPath } from './urls'

/** Read-side helpers for the admin SEO screen and its API. */

export interface SeriesOption {
  id: number
  slug: string
  title: string
}

export async function seriesOptions(db: Db, q?: string, limit = 20): Promise<SeriesOption[]> {
  const where = and(
    eq(series.state, 'published'),
    isNull(series.deletedAt),
    q ? or(ilike(series.title, `%${q}%`), ilike(series.slug, `%${q}%`)) : undefined,
  )
  return db
    .select({ id: series.id, slug: series.slug, title: series.title })
    .from(series)
    .where(where)
    .orderBy(desc(series.viewCount), series.title)
    .limit(limit)
}

export interface TemplatePreview {
  page: keyof SeoTemplates
  title: string
  description: string
  url: string
}

/** Render every page type's template against a real series (docs/12 §8 "live preview"). */
export async function previewTemplates(
  db: Db,
  settings: SeoSettings,
  templates: SeoTemplates,
  origin: string,
  slug?: string,
): Promise<{ series: SeriesOption | null; previews: TemplatePreview[] }> {
  const site = settings.identity.site_name
  const [s] = await db
    .select({
      id: series.id,
      slug: series.slug,
      title: series.title,
      type: series.type,
      synopsis: series.synopsis,
      chapterCount: series.chapterCount,
      releasedYear: series.releasedYear,
    })
    .from(series)
    .where(
      and(
        eq(series.state, 'published'),
        isNull(series.deletedAt),
        slug ? eq(series.slug, slug) : undefined,
      ),
    )
    .orderBy(desc(series.viewCount))
    .limit(1)

  const base: TemplateVars = { site }
  let seriesVars: TemplateVars = { ...base, title: 'Series title', type: 'Manhwa' }
  let chapterVars: TemplateVars = { ...base, title: 'Series title', chapter: '1' }
  let genreVars: TemplateVars = { ...base, genre: 'Action', count: 0, intro: '' }
  let paths = {
    series: '/series/example',
    chapter: '/series/example/chapter-1',
    genre: '/genres/action',
  }

  if (s) {
    const [latest] = await db
      .select({ number: chapters.number, publishedAt: chapters.publishedAt })
      .from(chapters)
      .where(
        and(
          eq(chapters.seriesId, s.id),
          eq(chapters.state, 'published'),
          isNull(chapters.deletedAt),
        ),
      )
      .orderBy(desc(chapters.number))
      .limit(1)
    const genreRows = await db
      .select({ id: genres.id, slug: genres.slug, name: genres.name, intro: genres.intro })
      .from(seriesGenres)
      .innerJoin(genres, eq(genres.id, seriesGenres.genreId))
      .where(and(eq(seriesGenres.seriesId, s.id), isNull(genres.deletedAt)))
    const authorRows = await db
      .select({ name: people.name })
      .from(seriesPeople)
      .innerJoin(people, eq(people.id, seriesPeople.personId))
      .where(and(eq(seriesPeople.seriesId, s.id), eq(seriesPeople.credit, 'author')))
    const n = latest ? formatChapterNumber(latest.number) : ''
    seriesVars = {
      ...base,
      title: s.title,
      type: messages.series.type[s.type],
      chapter_count: s.chapterCount,
      latest_chapter: latest ? `Ch. ${n}` : '',
      genres: genreRows.map((g) => g.name).join(', '),
      author: authorRows[0]?.name ?? '',
      year: s.releasedYear ?? '',
      synopsis: s.synopsis ?? '',
    }
    chapterVars = {
      ...seriesVars,
      chapter: n || '1',
      next_prev_hint:
        latest && latest.number > 1
          ? `Previous: Chapter ${formatChapterNumber(latest.number - 1)}.`
          : '',
    }
    const g = genreRows[0]
    if (g) {
      const [counted] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(seriesGenres)
        .where(eq(seriesGenres.genreId, g.id))
      genreVars = {
        ...base,
        genre: g.name,
        count: Number(counted?.count ?? 0),
        intro: plainText(g.intro),
      }
    }
    paths = {
      series: seriesPath(s.slug),
      chapter: chapterPath(s.slug, latest?.number ?? 1),
      genre: g ? genrePath(g.slug) : '/genres/action',
    }
  }

  const [ann] = await db
    .select({
      slug: announcements.slug,
      title: announcements.title,
      excerpt: announcements.excerpt,
    })
    .from(announcements)
    .where(eq(announcements.state, 'published'))
    .orderBy(desc(announcements.publishedAt))
    .limit(1)

  const vars: Record<keyof SeoTemplates, TemplateVars> = {
    home: base,
    series: seriesVars,
    chapter: chapterVars,
    genre: genreVars,
    rankings: base,
    announcement: { ...base, title: ann?.title ?? 'Announcement', excerpt: ann?.excerpt ?? '' },
  }
  const urls: Record<keyof SeoTemplates, string> = {
    home: '/',
    series: paths.series,
    chapter: paths.chapter,
    genre: paths.genre,
    rankings: '/rankings',
    announcement: ann ? announcementPath(ann.slug) : '/announcements',
  }
  const previews = (Object.keys(templates) as (keyof SeoTemplates)[]).map((page) => ({
    page,
    title: renderTemplate(templates[page].title, vars[page]),
    description: renderTemplate(templates[page].description, vars[page]),
    url: `${origin}${urls[page]}`,
  }))
  return { series: s ? { id: s.id, slug: s.slug, title: s.title } : null, previews }
}

const plainText = (doc: unknown): string => {
  const walk = (node: unknown): string => {
    if (typeof node !== 'object' || node === null) return ''
    const n = node as { type?: string; text?: string; children?: unknown[] }
    if (n.type === 'text') return n.text ?? ''
    return (
      (n.children ?? []).map(walk).join(n.type === 'paragraph' ? '' : '') +
      (n.type === 'paragraph' ? ' ' : '')
    )
  }
  return walk(doc).replace(/\s+/g, ' ').trim()
}

const indexNowLogSchema = z.object({
  at: z.string(),
  submitted: z.number(),
  status: z.number().nullable(),
  ok: z.boolean(),
  error: z.string().optional(),
})

export async function indexNowLog(db: Db): Promise<IndexNowLog | null> {
  const raw = await getSeoSetting<unknown>(db, INDEXNOW_LOG_KEY, null)
  const parsed = indexNowLogSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export type RedirectRow = typeof redirects.$inferSelect

export async function listRedirects(db: Db): Promise<RedirectRow[]> {
  return db
    .select()
    .from(redirects)
    .where(isNull(redirects.deletedAt))
    .orderBy(desc(redirects.hits), redirects.fromPath)
}

export interface SitemapBuildView {
  id: number
  kind: string
  urlCount: number
  files: { name: string; urls: number; bytes: number }[]
  error: string | null
  startedAt: string
  finishedAt: string | null
}

export async function sitemapBuildViews(db: Db, limit = 10): Promise<SitemapBuildView[]> {
  const rows = await recentSitemapBuilds(db, limit)
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    urlCount: r.urlCount,
    files: r.files,
    error: r.error,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  }))
}
