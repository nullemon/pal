import { gzipSync } from 'node:zlib'
import type { Storage } from '@palscans/core/storage'
import {
  announcements,
  chapters,
  type Db,
  genres,
  getDb,
  pages,
  type SitemapFile,
  seoSettings,
  series,
  sitemapBuilds,
} from '@palscans/db'
import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm'
import { getStorage } from '@/lib/storage'
import { getEnv } from '../env'
import { type IndexNowResult, submitIndexNow } from './indexnow'
import { loadSeoSettings, type SeoSettings, type SitemapSection } from './settings'
import { announcementPath, chapterPath, genrePath, seriesPath, storagePublicUrl } from './urls'
import { chunk, SITEMAP_MAX_URLS, type SitemapUrl, sitemapIndexXml, urlsetXml } from './xml'

/**
 * Sitemap builder (docs/12 §5). A worker-style job exposed as a callable module: the admin
 * "Regenerate now" button, the nightly job and the publish pipeline all call
 * `buildSitemaps`. Files are gzipped into storage under `sitemaps/` and listed in a
 * `sitemap_builds` row; the route handlers at /sitemap.xml and /sitemaps/* serve them.
 *
 * Full builds write every section. Incremental builds (`seriesIds`) rewrite only the
 * series-N and chapters-N files (one query each, ordered so the files stay stable) and keep
 * the other sections from the last successful build, then submit the changed URLs to
 * IndexNow.
 */

export const SITEMAP_PREFIX = 'sitemaps/'
export const SITEMAP_INDEX_KEY = `${SITEMAP_PREFIX}sitemap.xml`
export const SITEMAP_FILE_RE =
  /^(pages|genres|announcements|images|series-\d+|chapters-\d+)\.xml\.gz$/

export interface SitemapBuildOptions {
  kind: 'full' | 'incremental'
  /** Incremental builds: the series whose pages changed (IndexNow gets their URLs). */
  seriesIds?: number[]
  db?: Db
  storage?: Storage
  settings?: SeoSettings
  siteUrl?: string
  now?: Date
  /** Test hook for IndexNow. */
  fetchImpl?: typeof fetch
}

export interface SitemapBuildResult {
  id: number
  kind: 'full' | 'incremental'
  urlCount: number
  files: SitemapFile[]
  indexNow: IndexNowResult | null
  error: string | null
  startedAt: Date
  finishedAt: Date
}

export interface IndexNowLog {
  at: string
  submitted: number
  status: number | null
  ok: boolean
  error?: string
}

export const INDEXNOW_LOG_KEY = 'indexnow_last'

const STATIC_PAGES = ['/', '/browse', '/rankings', '/genres', '/announcements']

const sectionOf = (name: string): SitemapSection | null => {
  const m = /^([a-z]+)(?:-\d+)?\.xml\.gz$/.exec(name)
  return m ? (m[1] as SitemapSection) : null
}

interface Built {
  name: string
  urls: SitemapUrl[]
}

async function seriesRows(db: Db, settings: SeoSettings) {
  const states = settings.sitemap.include_unlisted
    ? or(eq(series.state, 'published'), eq(series.state, 'unlisted'))
    : eq(series.state, 'published')
  return db
    .select({
      id: series.id,
      slug: series.slug,
      title: series.title,
      coverKey: series.coverKey,
      lastChapterAt: series.lastChapterAt,
      updatedAt: series.updatedAt,
      canonicalUrl: series.canonicalUrl,
    })
    .from(series)
    .where(and(states, isNull(series.deletedAt), eq(series.noindex, false)))
    .orderBy(series.id)
}

async function chapterRows(db: Db, settings: SeoSettings) {
  const states = settings.sitemap.include_unlisted
    ? or(eq(series.state, 'published'), eq(series.state, 'unlisted'))
    : eq(series.state, 'published')
  return db
    .select({
      seriesId: chapters.seriesId,
      slug: series.slug,
      number: chapters.number,
      publishedAt: chapters.publishedAt,
      updatedAt: chapters.updatedAt,
    })
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(
      and(
        eq(chapters.state, 'published'),
        isNull(chapters.deletedAt),
        states,
        isNull(series.deletedAt),
        eq(series.noindex, false),
      ),
    )
    .orderBy(desc(chapters.publishedAt), desc(chapters.id))
}

/** Every section's URL lists; pure given rows, so the file layout is deterministic. */
export async function collectSitemapUrls(
  db: Db,
  settings: SeoSettings,
  origin: string,
  sections: readonly SitemapSection[],
): Promise<Built[]> {
  const abs = (p: string) => `${origin}${p}`
  const out: Built[] = []
  const want = new Set(sections)

  if (want.has('pages')) {
    const legal = await db
      .select({ slug: pages.slug, updatedAt: pages.updatedAt })
      .from(pages)
      .where(eq(pages.state, 'published'))
    out.push({
      name: 'pages.xml.gz',
      urls: [
        ...STATIC_PAGES.map((p) => ({ loc: abs(p) })),
        ...legal.map((p) => ({ loc: abs(`/${p.slug}`), lastmod: p.updatedAt })),
      ],
    })
  }

  const needSeries = want.has('series') || want.has('images')
  const rows = needSeries ? await seriesRows(db, settings) : []

  if (want.has('series')) {
    const urls = rows
      .filter((r) => !r.canonicalUrl) // mirrored titles point elsewhere; leave them out
      .map((r) => ({ loc: abs(seriesPath(r.slug)), lastmod: r.lastChapterAt ?? r.updatedAt }))
    for (const [i, part] of chunk(urls, SITEMAP_MAX_URLS).entries())
      out.push({ name: `series-${i + 1}.xml.gz`, urls: part })
    if (urls.length === 0) out.push({ name: 'series-1.xml.gz', urls: [] })
  }

  if (want.has('chapters') && settings.indexing.chapters) {
    const chapterList = await chapterRows(db, settings)
    const urls = chapterList.map((c) => ({
      loc: abs(chapterPath(c.slug, c.number)),
      lastmod: c.updatedAt ?? c.publishedAt,
    }))
    const per = Math.min(SITEMAP_MAX_URLS, settings.sitemap.chapters_per_file)
    for (const [i, part] of chunk(urls, per).entries())
      out.push({ name: `chapters-${i + 1}.xml.gz`, urls: part })
    if (urls.length === 0) out.push({ name: 'chapters-1.xml.gz', urls: [] })
  }

  if (want.has('genres')) {
    const list = await db.select({ slug: genres.slug }).from(genres).orderBy(genres.slug)
    out.push({ name: 'genres.xml.gz', urls: list.map((g) => ({ loc: abs(genrePath(g.slug)) })) })
  }

  if (want.has('announcements')) {
    const list = await db
      .select({ slug: announcements.slug, updatedAt: announcements.updatedAt })
      .from(announcements)
      .where(eq(announcements.state, 'published'))
      .orderBy(desc(announcements.publishedAt))
    out.push({
      name: 'announcements.xml.gz',
      urls: list.map((a) => ({ loc: abs(announcementPath(a.slug)), lastmod: a.updatedAt })),
    })
  }

  if (want.has('images')) {
    const urls: SitemapUrl[] = []
    for (const r of rows) {
      const cover = storagePublicUrl(r.coverKey)
      if (!cover) continue
      urls.push({
        loc: abs(seriesPath(r.slug)),
        images: [{ url: cover, title: `${r.title} cover` }],
      })
    }
    out.push({ name: 'images.xml.gz', urls })
  }

  return out
}

/** The last successful build's file list, for merging incremental builds. */
export async function lastSitemapBuild(db: Db) {
  const [row] = await db
    .select()
    .from(sitemapBuilds)
    .where(isNull(sitemapBuilds.error))
    .orderBy(desc(sitemapBuilds.id))
    .limit(1)
  return row ?? null
}

export async function recentSitemapBuilds(db: Db, limit = 10) {
  return db.select().from(sitemapBuilds).orderBy(desc(sitemapBuilds.id)).limit(limit)
}

async function writeIndexNowLog(db: Db, log: IndexNowLog): Promise<void> {
  await db
    .insert(seoSettings)
    .values({ key: INDEXNOW_LOG_KEY, value: log })
    .onConflictDoUpdate({
      target: seoSettings.key,
      set: { value: log, updatedAt: sql`now()` },
    })
}

export async function buildSitemaps(opts: SitemapBuildOptions): Promise<SitemapBuildResult> {
  const db = opts.db ?? (await getDb())
  const storage = opts.storage ?? (await getStorage())
  const settings = opts.settings ?? (await loadSeoSettings(db))
  const origin = new URL(opts.siteUrl ?? getEnv().SITE_URL).origin
  const startedAt = opts.now ?? new Date()

  const [row] = await db
    .insert(sitemapBuilds)
    .values({ kind: opts.kind, urlCount: 0, files: [], startedAt })
    .returning({ id: sitemapBuilds.id })
  const id = row?.id ?? 0

  try {
    const enabled = settings.sitemap.sections
    const sections: SitemapSection[] =
      opts.kind === 'incremental'
        ? enabled.filter((s) => s === 'series' || s === 'chapters')
        : [...enabled]
    const built = await collectSitemapUrls(db, settings, origin, sections)

    const files: SitemapFile[] = []
    for (const file of built) {
      const body = gzipSync(Buffer.from(urlsetXml(file.urls), 'utf8'))
      await storage.put(`${SITEMAP_PREFIX}${file.name}`, new Uint8Array(body), {
        contentType: 'application/gzip',
        cacheControl: 'public, max-age=300',
      })
      files.push({ name: file.name, urls: file.urls.length, bytes: body.byteLength })
    }

    // Incremental: keep the other sections' files from the previous successful build.
    if (opts.kind === 'incremental') {
      const previous = await lastSitemapBuild(db)
      const rebuilt = new Set(sections)
      for (const f of previous?.files ?? []) {
        const section = sectionOf(f.name)
        if (section && !rebuilt.has(section) && enabled.includes(section)) files.push(f)
      }
    }
    // Sitemap files that are no longer produced (a section switched off) are dropped from
    // the index; their objects stay in storage until the next full build overwrites them.
    files.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))

    const finishedAt = new Date()
    const index = sitemapIndexXml(
      files.map((f) => ({ loc: `${origin}/sitemaps/${f.name}`, lastmod: finishedAt })),
    )
    await storage.put(SITEMAP_INDEX_KEY, index, {
      contentType: 'application/xml',
      cacheControl: 'public, max-age=300',
    })

    const urlCount = files.reduce((n, f) => n + f.urls, 0)
    await db
      .update(sitemapBuilds)
      .set({ urlCount, files, finishedAt })
      .where(eq(sitemapBuilds.id, id))

    let indexNow: IndexNowResult | null = null
    const key = settings.sitemap.indexnow_key
    if (key && opts.kind === 'incremental' && opts.seriesIds?.length) {
      const urls = await changedUrls(db, origin, opts.seriesIds)
      indexNow = await submitIndexNow({
        siteUrl: origin,
        key,
        urls,
        fetchImpl: opts.fetchImpl,
      })
      await writeIndexNowLog(db, { at: new Date().toISOString(), ...indexNow })
    }

    return { id, kind: opts.kind, urlCount, files, indexNow, error: null, startedAt, finishedAt }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    const finishedAt = new Date()
    await db.update(sitemapBuilds).set({ error, finishedAt }).where(eq(sitemapBuilds.id, id))
    return {
      id,
      kind: opts.kind,
      urlCount: 0,
      files: [],
      indexNow: null,
      error,
      startedAt,
      finishedAt,
    }
  }
}

/** The series pages plus their chapters published in the last 7 days — what IndexNow gets. */
async function changedUrls(db: Db, origin: string, seriesIds: number[]): Promise<string[]> {
  const rows = await db
    .select({ id: series.id, slug: series.slug, noindex: series.noindex, state: series.state })
    .from(series)
    .where(and(inArray(series.id, seriesIds), isNull(series.deletedAt)))
  const visible = rows.filter((r) => r.state === 'published' && !r.noindex)
  const urls = visible.map((r) => `${origin}${seriesPath(r.slug)}`)
  if (visible.length === 0) return urls
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000)
  const recent = await db
    .select({ slug: series.slug, number: chapters.number })
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(
      and(
        inArray(
          chapters.seriesId,
          visible.map((r) => r.id),
        ),
        eq(chapters.state, 'published'),
        isNull(chapters.deletedAt),
        gte(chapters.publishedAt, since),
      ),
    )
  for (const c of recent) urls.push(`${origin}${chapterPath(c.slug, c.number)}`)
  return urls
}

/** Read a built file from storage (null when never built). */
export async function readSitemapFile(name: string, storage?: Storage): Promise<Uint8Array | null> {
  const s = storage ?? (await getStorage())
  return s.get(`${SITEMAP_PREFIX}${name}`)
}

export async function readSitemapIndex(storage?: Storage): Promise<string | null> {
  const s = storage ?? (await getStorage())
  const bytes = await s.get(SITEMAP_INDEX_KEY)
  return bytes ? Buffer.from(bytes).toString('utf8') : null
}
