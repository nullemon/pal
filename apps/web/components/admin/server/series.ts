import {
  chapters,
  genres,
  geoRestrictions,
  getDb,
  people,
  series,
  seriesGenres,
  seriesPeople,
  seriesTitles,
} from '@palscans/db'
import { and, asc, count, desc, eq, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm'
import type { SeriesDoc } from '../schemas'
import { PAGE_SIZE } from './params'

export interface SeriesListParams {
  q?: string
  state?: string
  type?: string
  page: number
  trash?: boolean
}

export const loadSeriesList = async (p: SeriesListParams) => {
  const db = await getDb()
  const where = and(
    p.trash ? isNotNull(series.deletedAt) : isNull(series.deletedAt),
    p.q ? or(ilike(series.title, `%${p.q}%`), ilike(series.slug, `%${p.q}%`)) : undefined,
    p.state ? eq(series.state, p.state as typeof series.$inferSelect.state) : undefined,
    p.type ? eq(series.type, p.type as typeof series.$inferSelect.type) : undefined,
  )
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: series.id,
        slug: series.slug,
        title: series.title,
        type: series.type,
        status: series.status,
        state: series.state,
        coverKey: series.coverKey,
        coverColor: series.coverColor,
        chapterCount: series.chapterCount,
        viewCount: series.viewCount,
        lastChapterAt: series.lastChapterAt,
        updatedAt: series.updatedAt,
        isFeatured: series.isFeatured,
        isPinned: series.isPinned,
      })
      .from(series)
      .where(where)
      .orderBy(desc(series.updatedAt))
      .limit(PAGE_SIZE)
      .offset((p.page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(series).where(where),
  ])
  return { rows, total: total?.n ?? 0, pages: Math.max(1, Math.ceil((total?.n ?? 0) / PAGE_SIZE)) }
}

export type SeriesRow = typeof series.$inferSelect

export interface SeriesEditorData {
  row: SeriesRow
  doc: SeriesDoc
  genres: Array<{ id: number; name: string; kind: string }>
  linked: { id: number; title: string; slug: string } | null
  chapters: Array<{
    id: number
    number: number
    title: string | null
    volume: number | null
    state: string
    isPremium: boolean
    earlyAccessUntil: Date | null
    publishedAt: Date | null
    pageCount: number
    viewCount: number
    deletedAt: Date | null
    errors: number
    done: number
    total: number
  }>
}

export const loadSeriesEditor = async (id: number): Promise<SeriesEditorData | null> => {
  const db = await getDb()
  const [row] = await db.select().from(series).where(eq(series.id, id)).limit(1)
  if (!row) return null
  const [titles, credits, sg, allGenres, geo, chapterRows, linked] = await Promise.all([
    db
      .select({ title: seriesTitles.title, lang: seriesTitles.lang })
      .from(seriesTitles)
      .where(eq(seriesTitles.seriesId, id))
      .orderBy(asc(seriesTitles.id)),
    db
      .select({ id: people.id, name: people.name, credit: seriesPeople.credit })
      .from(seriesPeople)
      .innerJoin(people, eq(people.id, seriesPeople.personId))
      .where(eq(seriesPeople.seriesId, id))
      .orderBy(asc(seriesPeople.credit), asc(people.name)),
    db
      .select({ genreId: seriesGenres.genreId })
      .from(seriesGenres)
      .where(eq(seriesGenres.seriesId, id)),
    db
      .select({ id: genres.id, name: genres.name, kind: genres.kind })
      .from(genres)
      .orderBy(asc(genres.kind), asc(genres.name)),
    db
      .select({ country: geoRestrictions.country, mode: geoRestrictions.mode })
      .from(geoRestrictions)
      .where(eq(geoRestrictions.seriesId, id)),
    db
      .select({
        id: chapters.id,
        number: chapters.number,
        title: chapters.title,
        volume: chapters.volume,
        state: chapters.state,
        isPremium: chapters.isPremium,
        earlyAccessUntil: chapters.earlyAccessUntil,
        publishedAt: chapters.publishedAt,
        pageCount: chapters.pageCount,
        viewCount: chapters.viewCount,
        deletedAt: chapters.deletedAt,
        processing: chapters.processing,
      })
      .from(chapters)
      .where(eq(chapters.seriesId, id))
      .orderBy(desc(chapters.number)),
    row.linkedSeriesId
      ? db
          .select({ id: series.id, title: series.title, slug: series.slug })
          .from(series)
          .where(eq(series.id, row.linkedSeriesId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ])
  const geoMode = geo.find((g) => g.mode === 'allow') ? 'allow' : 'block'
  const seoText = row.seoText
    ? (row.seoText.children as Array<{ children?: Array<{ text?: string }> }>)
        .map((p) => (p.children ?? []).map((c) => c.text ?? '').join(''))
        .join('\n')
    : null
  const doc: SeriesDoc = {
    title: row.title,
    slug: row.slug,
    type: row.type,
    status: row.status,
    state: row.state,
    synopsis: row.synopsis,
    releasedYear: row.releasedYear,
    serialization: row.serialization,
    ageRating: (row.ageRating as SeriesDoc['ageRating']) ?? null,
    readingDirection: row.readingDirection,
    releaseSchedule: row.releaseSchedule ?? null,
    contentWarnings: row.contentWarnings,
    titles,
    people: credits.map((c) => ({
      id: c.id,
      name: c.name,
      credit: c.credit as SeriesDoc['people'][number]['credit'],
    })),
    genreIds: sg.map((g) => g.genreId),
    linkedSeriesId: row.linkedSeriesId,
    isFeatured: row.isFeatured,
    isPinned: row.isPinned,
    commentsEnabled: row.commentsEnabled,
    geo: { mode: geoMode, countries: geo.filter((g) => g.mode === geoMode).map((g) => g.country) },
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    focusKeyword: row.focusKeyword,
    seoText,
    noindex: row.noindex,
    canonicalUrl: row.canonicalUrl,
    ogImageKey: row.ogImageKey,
  }
  return {
    row,
    doc,
    genres: allGenres,
    linked,
    chapters: chapterRows.map((c) => ({
      ...c,
      errors: Object.keys(c.processing?.errors ?? {}).length,
      done: c.processing?.progress.done ?? c.pageCount,
      total: c.processing?.progress.total ?? c.pageCount,
    })),
  }
}

/** Plain text → the RichText doc shape used by docs/12 (one paragraph per line). */
export const richTextFromPlain = (text: string | null) =>
  text
    ? {
        type: 'doc' as const,
        children: text
          .split(/\n+/)
          .map((l) => l.trim())
          .filter(Boolean)
          .map((line) => ({ type: 'paragraph', children: [{ type: 'text', text: line }] })),
      }
    : null

export const slugTaken = async (slug: string, exceptId: number | null): Promise<boolean> => {
  const db = await getDb()
  const [row] = await db
    .select({ id: series.id })
    .from(series)
    .where(and(eq(series.slug, slug), exceptId ? sql`${series.id} <> ${exceptId}` : undefined))
    .limit(1)
  return !!row
}
