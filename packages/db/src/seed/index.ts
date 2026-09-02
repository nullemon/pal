import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { hash } from '@node-rs/argon2'
import {
  bodyFromText,
  createStorage,
  findRepoRoot,
  parseRelative,
  type Storage,
  slugify,
} from '@palscans/core'
import { count as countFn, eq, sql } from 'drizzle-orm'
import type { Db } from '../client.js'
import * as s from '../schema/index.js'
import { CATALOG, EXTRA_GENRES } from './data/catalog.js'
import {
  COMMENT_TEXTS,
  generateTitles,
  personName,
  READER_NAMES,
  REPLY_TEXTS,
  rng,
  SPOILER_TEXTS,
  studioName,
} from './data/generated.js'
import { GENRES } from './data/genres.js'
import {
  ADS,
  APPEARANCE,
  COMMENTS,
  DARK_TOKENS,
  HOME_LAYOUT,
  LAYOUTS,
  LIGHT_TOKENS,
  MENUS,
  resolveCss,
  SEO,
  SITE,
} from './data/settings.js'

export const SEED_PASSWORD = 'palscans-dev'

export const SEED_ACCOUNTS = [
  { email: 'admin@palscans.org', username: 'admin', role: 'admin', displayName: 'PALScans Admin' },
  { email: 'mod@palscans.org', username: 'mod', role: 'moderator', displayName: 'Moderator' },
  {
    email: 'uploader@palscans.org',
    username: 'uploader',
    role: 'uploader',
    displayName: 'Uploader',
  },
  {
    email: 'premium@palscans.org',
    username: 'premium',
    role: 'premium',
    displayName: 'Premium Reader',
  },
  { email: 'reader@palscans.org', username: 'reader', role: 'user', displayName: 'Reader' },
] as const satisfies readonly {
  email: string
  username: string
  role: s.UserRole
  displayName: string
}[]

export interface SeedOptions {
  /** Number of generated (non-catalog) series, default 120. */
  generatedCount?: number
  /** Storage to copy covers and pages into; default: the fs driver from the environment. */
  storage?: Storage
  /** "Now" for relative timestamps; default: current time. */
  now?: Date
  /** Path of the repo's design folder; default: <repo>/design. */
  designDir?: string
  log?: (msg: string) => void
}

export interface SeedResult {
  genres: number
  people: number
  users: number
  series: number
  chapters: number
  chapterPages: number
  comments: number
  bookmarks: number
  ratings: number
}

interface Asset {
  key: string
  width: number
  height: number
  bytes: number
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const svgSize = (svg: string): { width: number; height: number } => {
  const m = /viewBox="\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*"/.exec(svg)
  if (!m?.[1] || !m[2]) throw new Error('SVG without a viewBox')
  return { width: Math.round(Number(m[1])), height: Math.round(Number(m[2])) }
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Idempotent development seed: catalog + generated series, chapters with pages copied
 * into storage, users, bookmarks, ratings, comments, announcement and default settings.
 * Keyed by slug / email; safe to run repeatedly.
 */
export const seed = async (db: Db, opts: SeedOptions = {}): Promise<SeedResult> => {
  const log = opts.log ?? (() => undefined)
  const now = opts.now ?? new Date()
  // One PRNG stream per phase, so skipping a phase on re-run (e.g. chapters already seeded)
  // does not shift the values later phases derive — that is what keeps the seed idempotent.
  const r = rng(20260902)
  const rStats = rng(20260903)
  const rSocial = rng(20260904)
  const rComments = rng(20260905)
  const storage = opts.storage ?? (await createStorage())
  const designDir = opts.designDir ?? path.join(findRepoRoot(), 'design')
  const generatedCount = opts.generatedCount ?? 120

  // ---- assets ------------------------------------------------------------------------
  const copyAssets = async (
    dir: string,
    prefix: string,
    filter: RegExp,
  ): Promise<Map<string, Asset>> => {
    const out = new Map<string, Asset>()
    const files = (await readdir(dir)).filter((f) => filter.test(f)).sort()
    for (const file of files) {
      const abs = path.join(dir, file)
      const key = `${prefix}/${file}`
      const svg = await readFile(abs, 'utf8')
      const { width, height } = svgSize(svg)
      const bytes = (await stat(abs)).size
      if (!(await storage.exists(key)))
        await storage.put(key, svg, { contentType: 'image/svg+xml' })
      out.set(file, { key, width, height, bytes })
    }
    return out
  }
  const covers = await copyAssets(
    path.join(designDir, 'mockups', 'covers'),
    'covers',
    /^cover-\d+\.svg$/,
  )
  const pages = await copyAssets(path.join(designDir, 'pages'), 'pages', /^page-[cm]-\d+\.svg$/)
  const stripPages = [...pages.values()].filter((p) => p.key.includes('page-c-'))
  const mangaPages = [...pages.values()].filter((p) => p.key.includes('page-m-'))
  log(`assets: ${covers.size} covers, ${pages.size} pages`)

  // ---- genres ------------------------------------------------------------------------
  const genreRows = [
    ...GENRES,
    ...EXTRA_GENRES.map((g) => ({ slug: slugify(g.name), name: g.name, kind: g.kind })),
  ]
  const genreIdBySlug = new Map<string, number>()
  for (const batch of chunk(genreRows, 100)) {
    const rows = await db
      .insert(s.genres)
      .values(batch)
      .onConflictDoUpdate({
        target: s.genres.slug,
        set: { name: sql`excluded.name`, kind: sql`excluded.kind` },
      })
      .returning({ id: s.genres.id, slug: s.genres.slug })
    for (const g of rows) genreIdBySlug.set(g.slug, g.id)
  }
  const genreId = (name: string) => {
    const id = genreIdBySlug.get(slugify(name))
    if (!id) throw new Error(`Unknown genre ${name}`)
    return id
  }
  const genreSlugs = [...genreIdBySlug.keys()]
  const genreSlugsByKind = {
    genre: genreRows.filter((g) => g.kind === 'genre').map((g) => g.slug),
    theme: genreRows.filter((g) => g.kind === 'theme').map((g) => g.slug),
  }
  log(`genres: ${genreSlugs.length}`)

  // ---- people ------------------------------------------------------------------------
  const personIdBySlug = new Map<string, number>()
  const upsertPeople = async (names: string[]) => {
    const unique = [...new Set(names)].filter((n) => !personIdBySlug.has(slugify(n)))
    if (unique.length === 0) return
    for (const batch of chunk(unique, 200)) {
      const rows = await db
        .insert(s.people)
        .values(batch.map((name) => ({ slug: slugify(name), name })))
        .onConflictDoUpdate({ target: s.people.slug, set: { name: sql`excluded.name` } })
        .returning({ id: s.people.id, slug: s.people.slug })
      for (const p of rows) personIdBySlug.set(p.slug, p.id)
    }
  }

  // ---- group -------------------------------------------------------------------------
  const [group] = await db
    .insert(s.groups)
    .values({
      slug: 'palscans',
      name: 'PALScans',
      description: 'The in-house scanlation team.',
      links: { discord: SITE.discord_url, site: SITE.url },
    })
    .onConflictDoUpdate({ target: s.groups.slug, set: { name: sql`excluded.name` } })
    .returning({ id: s.groups.id })
  const groupId = group?.id as number

  // ---- users -------------------------------------------------------------------------
  const passwordHash = await hash(SEED_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 })
  const userRows = [
    ...SEED_ACCOUNTS.map((a, i) => ({
      email: a.email,
      username: a.username,
      role: a.role,
      displayName: a.displayName,
      passwordHash,
      emailVerifiedAt: now,
      createdAt: new Date(now.getTime() - (400 - i) * DAY),
    })),
    ...READER_NAMES.map((name, i) => ({
      email: `${name}@example.com`,
      username: name,
      role: (i % 9 === 0 ? 'premium' : i % 7 === 0 ? 'supporter' : 'user') as s.UserRole,
      displayName: name.replace(/[_0-9]+/g, ' ').trim(),
      passwordHash,
      emailVerifiedAt: now,
      createdAt: new Date(now.getTime() - r.int(2, 700) * DAY),
    })),
  ]
  const userIdByEmail = new Map<string, number>()
  for (const batch of chunk(userRows, 50)) {
    const rows = await db
      .insert(s.users)
      .values(batch)
      .onConflictDoUpdate({
        target: s.users.email,
        set: {
          role: sql`excluded.role`,
          passwordHash: sql`excluded.password_hash`,
          displayName: sql`excluded.display_name`,
          updatedAt: now,
        },
      })
      .returning({ id: s.users.id, email: s.users.email })
    for (const u of rows) userIdByEmail.set(u.email.toLowerCase(), u.id)
  }
  const uid = (email: string) => userIdByEmail.get(email) as number
  const adminId = uid('admin@palscans.org')
  const uploaderId = uid('uploader@palscans.org')
  const premiumId = uid('premium@palscans.org')
  const readerId = uid('reader@palscans.org')
  const readerIds = READER_NAMES.map((n) => uid(`${n}@example.com`))
  const commenterIds = [...readerIds, premiumId, readerId, uid('mod@palscans.org')]

  await db
    .insert(s.entitlements)
    .values(
      ['early_access', 'premium_content', 'no_ads'].map((feature) => ({
        userId: premiumId,
        feature,
        source: 'grant',
        expiresAt: null,
      })),
    )
    .onConflictDoNothing()
  await db
    .insert(s.plans)
    .values([
      {
        id: 'supporter',
        name: 'Supporter',
        priceCents: 200,
        interval: 'month',
        stripePriceId: 'price_dev_supporter',
      },
      {
        id: 'premium',
        name: 'Premium',
        priceCents: 500,
        interval: 'month',
        stripePriceId: 'price_dev_premium',
      },
    ])
    .onConflictDoNothing()
  log(`users: ${userIdByEmail.size}`)

  // ---- series ------------------------------------------------------------------------
  interface SeriesPlan {
    slug: string
    title: string
    type: s.SeriesType
    status: s.SeriesStatus
    synopsis: string
    cover: Asset
    year: number
    genres: string[]
    author: string
    artist: string
    altTitles: { title: string; lang?: string }[]
    isFeatured: boolean
    isPinned: boolean
    latest: number
    chapterCount: number
    latestAt: Date
    spacingDays: () => number
    latestPages?: number
    earlyAccessLatest: boolean
    scheduledNext: Date | null
    ratingTarget: { rating: number; count: number } | null
    bookmarkTarget: number | null
    viewCount: number
    dailyViews: number
    catalogN: number | null
  }

  const plans: SeriesPlan[] = CATALOG.map((c) => {
    const cover = covers.get(c.cover)
    if (!cover) throw new Error(`Missing cover ${c.cover}`)
    // Catalog titles carry their full history so `series.chapter_count` matches BRIEF.md.
    const chapterCount = c.latest
    return {
      slug: slugify(c.title),
      title: c.title,
      type: c.type,
      status: c.status,
      synopsis: c.synopsis,
      cover,
      year: c.year,
      genres: c.genres,
      author: c.author,
      artist: c.artist,
      altTitles: c.altTitles ?? [],
      isFeatured: c.n <= 6,
      isPinned: c.n === 1 || c.n === 4,
      latest: c.latest,
      chapterCount,
      latestAt: parseRelative(c.updated, now),
      spacingDays: c.n === 1 ? () => 3 : () => r.int(2, 7),
      latestPages: c.n === 1 ? 34 : undefined,
      earlyAccessLatest: c.n === 1,
      scheduledNext:
        c.n === 1
          ? new Date(now.getTime() + 2 * DAY + 4 * HOUR)
          : c.n === 3
            ? new Date(now.getTime() + 5 * HOUR)
            : null,
      ratingTarget: { rating: c.rating, count: c.ratingCount ?? r.int(800, 9000) },
      bookmarkTarget: c.bookmarks ?? r.int(4000, 60000),
      viewCount: (17 - c.n) * 1_000_000 + r.int(0, 400_000),
      dailyViews: (17 - c.n) * 400,
      catalogN: c.n,
    }
  })

  const taken = new Set(CATALOG.map((c) => c.title.toLowerCase()))
  const extraCovers = [...covers.values()].filter(
    (c) => !CATALOG.some((k) => c.key.endsWith(k.cover)),
  )
  const coverPool = extraCovers.length ? extraCovers : [...covers.values()]
  const types: s.SeriesType[] = [
    'manhwa',
    'manhwa',
    'manhwa',
    'manhwa',
    'manhwa',
    'manhwa',
    'manhua',
    'manhua',
    'manga',
    'manga',
    'comic',
  ]
  const statuses: s.SeriesStatus[] = [
    'ongoing',
    'ongoing',
    'ongoing',
    'ongoing',
    'ongoing',
    'ongoing',
    'ongoing',
    'completed',
    'completed',
    'hiatus',
    'dropped',
  ]
  for (const title of generateTitles(r, generatedCount, taken)) {
    const type = r.pick(types)
    const status = r.pick(statuses)
    const latest = r.int(5, 40)
    const rating = Math.round((6.4 + r.next() * 2.6) * 10) / 10
    plans.push({
      slug: slugify(title),
      title,
      type,
      status,
      synopsis: `${title} follows ${personName(r, type).split(' ')[1]}, who ${r.pick(['wakes on the day everything went wrong', 'inherits a debt nobody can explain', 'signs a contract with the wrong god', 'finds a door that should not be there', 'is the only survivor of a gate nobody remembers opening'])}. ${r.pick(['Slow-burn, character-first and quietly ambitious.', 'Fast, loud and very funny about it.', 'A revenge story that keeps its receipts.', 'Big fights, bigger feelings.', 'A mystery with a map at its centre.'])}`,
      cover: r.pick(coverPool),
      year: r.int(2017, 2025),
      genres: [
        ...r.shuffle(genreSlugsByKind.genre).slice(0, r.int(2, 4)),
        ...r.shuffle(genreSlugsByKind.theme).slice(0, r.int(1, 3)),
      ],
      author: personName(r, type),
      artist: r.chance(0.5) ? studioName(r) : personName(r, type),
      altTitles: [],
      isFeatured: false,
      isPinned: false,
      latest,
      chapterCount: latest,
      latestAt: new Date(now.getTime() - r.int(1, 60 * 24) * HOUR),
      spacingDays: () => r.int(2, 10),
      earlyAccessLatest: false,
      scheduledNext: null,
      ratingTarget: r.chance(0.7) ? { rating, count: r.int(5, 900) } : null,
      bookmarkTarget: null,
      viewCount: r.int(1_000, 500_000),
      dailyViews: r.int(5, 300),
      catalogN: null,
    })
  }

  await upsertPeople(plans.flatMap((p) => [p.author, p.artist]))
  log(`people: ${personIdBySlug.size}`)

  const seriesIdBySlug = new Map<string, number>()
  for (const batch of chunk(plans, 50)) {
    const rows = await db
      .insert(s.series)
      .values(
        batch.map((p) => ({
          slug: p.slug,
          title: p.title,
          type: p.type,
          status: p.status,
          state: 'published' as const,
          synopsis: p.synopsis,
          coverKey: p.cover.key,
          country:
            p.type === 'manga'
              ? 'JP'
              : p.type === 'manhua'
                ? 'CN'
                : p.type === 'manhwa'
                  ? 'KR'
                  : 'US',
          releasedYear: p.year,
          ageRating: 'teen',
          isFeatured: p.isFeatured,
          isPinned: p.isPinned,
          readingDirection: p.type === 'manga' ? ('rtl' as const) : ('vertical' as const),
          releaseSchedule:
            p.status === 'ongoing'
              ? { weekday: r.int(0, 6), time: '18:00', tz: 'Asia/Seoul' }
              : null,
          contentWarnings:
            p.genres.includes('gore') || p.genres.includes('Gore') ? ['violence', 'gore'] : [],
          publishedAt: new Date(p.latestAt.getTime() - p.chapterCount * 5 * DAY),
          viewCount: p.viewCount,
        })),
      )
      .onConflictDoUpdate({
        target: s.series.slug,
        set: {
          title: sql`excluded.title`,
          type: sql`excluded.type`,
          status: sql`excluded.status`,
          state: sql`excluded.state`,
          synopsis: sql`excluded.synopsis`,
          coverKey: sql`excluded.cover_key`,
          isFeatured: sql`excluded.is_featured`,
          isPinned: sql`excluded.is_pinned`,
          readingDirection: sql`excluded.reading_direction`,
          updatedAt: now,
        },
      })
      .returning({ id: s.series.id, slug: s.series.slug })
    for (const row of rows) seriesIdBySlug.set(row.slug.toLowerCase(), row.id)
  }
  const sid = (p: SeriesPlan) => seriesIdBySlug.get(p.slug) as number

  // linked novel cross-sell for the series page subject
  const frost = plans[0] as SeriesPlan
  const [novel] = await db
    .insert(s.series)
    .values({
      slug: 'return-of-the-frost-monarch-novel',
      title: 'Return of the Frost Monarch (Novel)',
      type: 'novel',
      status: 'ongoing',
      state: 'published',
      synopsis: frost.synopsis,
      coverKey: frost.cover.key,
      country: 'KR',
      releasedYear: 2021,
      readingDirection: 'ltr',
      publishedAt: new Date(now.getTime() - 900 * DAY),
    })
    .onConflictDoUpdate({ target: s.series.slug, set: { title: sql`excluded.title` } })
    .returning({ id: s.series.id })
  await db
    .update(s.series)
    .set({ linkedSeriesId: novel?.id ?? null })
    .where(eq(s.series.id, sid(frost)))

  await db
    .insert(s.seriesGenres)
    .values(plans.flatMap((p) => p.genres.map((g) => ({ seriesId: sid(p), genreId: genreId(g) }))))
    .onConflictDoNothing()
  await db
    .insert(s.seriesPeople)
    .values(
      plans.flatMap((p) => {
        const author = personIdBySlug.get(slugify(p.author)) as number
        const artist = personIdBySlug.get(slugify(p.artist)) as number
        return [
          { seriesId: sid(p), personId: author, credit: 'author' },
          { seriesId: sid(p), personId: artist, credit: 'artist' },
        ]
      }),
    )
    .onConflictDoNothing()
  const titleRows = plans.flatMap((p) =>
    p.altTitles.map((t) => ({ seriesId: sid(p), title: t.title, lang: t.lang ?? null })),
  )
  if (titleRows.length) await db.insert(s.seriesTitles).values(titleRows).onConflictDoNothing()
  log(`series: ${seriesIdBySlug.size}`)

  // ---- chapters + pages --------------------------------------------------------------
  const existing = await db
    .select({ seriesId: s.chapters.seriesId, n: countFn() })
    .from(s.chapters)
    .groupBy(s.chapters.seriesId)
  const hasChapters = new Set(existing.filter((e) => Number(e.n) > 0).map((e) => e.seriesId))

  let chapterRows = 0
  let pageRows = 0
  const latestChapterId = new Map<number, number>()
  interface ChapterInsert {
    seriesId: number
    number: number
    title: string | null
    state: s.ChapterState
    isPremium: boolean
    earlyAccessUntil: Date | null
    publishedAt: Date
    uploadedBy: number
    createdAt: Date
    updatedAt: Date
  }
  const pageFiles = (type: s.SeriesType) => (type === 'manga' ? mangaPages : stripPages)

  for (const batch of chunk(
    plans.filter((p) => !hasChapters.has(sid(p))),
    10,
  )) {
    const inserts: ChapterInsert[] = []
    const pagesPerChapter = new Map<string, number>()
    for (const p of batch) {
      let at = p.latestAt
      const numbers: number[] = []
      for (let i = 0; i < p.chapterCount; i++) numbers.push(p.latest - i)
      if (p.catalogN === null && p.chapterCount >= 8 && r.chance(0.15))
        numbers.push(p.latest - r.int(2, p.chapterCount - 2) + 0.5)
      numbers.sort((a, b) => b - a)
      numbers.forEach((n, i) => {
        const isLatest = i === 0
        const premiumWindow =
          p.catalogN === null && p.status === 'ongoing' && i < 2 && r.chance(0.3)
        inserts.push({
          seriesId: sid(p),
          number: n,
          title: r.chance(0.25)
            ? r.pick([
                'The Long Winter',
                'Debts',
                'A Door in the Wall',
                'What the Map Said',
                'Ashes',
                'Homecoming',
                'The Ninth',
                'Receipts',
                'Static',
                'Lanterns',
              ])
            : null,
          state: 'published',
          isPremium: premiumWindow,
          earlyAccessUntil:
            isLatest && p.earlyAccessLatest ? new Date(now.getTime() + 23 * HOUR) : null,
          publishedAt: at,
          uploadedBy: uploaderId,
          createdAt: at,
          updatedAt: at,
        })
        pagesPerChapter.set(
          `${sid(p)}:${n}`,
          isLatest && p.latestPages ? p.latestPages : r.int(8, 14),
        )
        at = new Date(at.getTime() - p.spacingDays() * DAY - r.int(0, 6) * HOUR)
      })
      if (p.scheduledNext) {
        inserts.push({
          seriesId: sid(p),
          number: p.latest + 1,
          title: null,
          state: 'scheduled',
          isPremium: false,
          earlyAccessUntil: null,
          publishedAt: p.scheduledNext,
          uploadedBy: uploaderId,
          createdAt: now,
          updatedAt: now,
        })
        pagesPerChapter.set(`${sid(p)}:${p.latest + 1}`, r.int(8, 14))
      }
    }
    const inserted: { id: number; seriesId: number; number: number; state: s.ChapterState }[] = []
    for (const part of chunk(inserts, 200)) {
      const returning = {
        id: s.chapters.id,
        seriesId: s.chapters.seriesId,
        number: s.chapters.number,
        state: s.chapters.state,
      }
      const rows = await db
        .insert(s.chapters)
        .values(part)
        .onConflictDoNothing()
        .returning(returning)
      inserted.push(...rows)
    }
    chapterRows += inserted.length
    const typeBySeries = new Map(batch.map((p) => [sid(p), p.type]))
    const pageInserts = inserted.flatMap((c) => {
      const files = pageFiles(typeBySeries.get(c.seriesId) ?? 'manhwa')
      const n = pagesPerChapter.get(`${c.seriesId}:${c.number}`) ?? 10
      const offset = r.int(0, files.length - 1)
      return Array.from({ length: n }, (_, idx) => {
        const f = files[(offset + idx) % files.length] as Asset
        return {
          chapterId: c.id,
          idx,
          key: f.key,
          width: f.width,
          height: f.height,
          bytes: f.bytes,
          blurHash: null,
          variants: [{ w: f.width, fmt: 'svg' as const, bytes: f.bytes, key: f.key }],
        }
      })
    })
    for (const part of chunk(pageInserts, 500)) {
      await db.insert(s.chapterPages).values(part).onConflictDoNothing()
      pageRows += part.length
    }
    for (const c of inserted) {
      if (c.state !== 'published') continue
      const prev = latestChapterId.get(c.seriesId)
      if (!prev) latestChapterId.set(c.seriesId, c.id)
    }
    const catalogChapterIds = inserted
      .filter((c) => batch.some((p) => p.catalogN !== null && sid(p) === c.seriesId))
      .map((c) => c.id)
    if (catalogChapterIds.length) {
      await db
        .insert(s.chapterGroups)
        .values(catalogChapterIds.map((chapterId) => ({ chapterId, groupId })))
        .onConflictDoNothing()
    }
  }
  log(`chapters: +${chapterRows}, pages: +${pageRows}`)

  // ---- popularity: daily stats + counters --------------------------------------------
  const statRows = plans.flatMap((p) =>
    Array.from({ length: 30 }, (_, i) => ({
      seriesId: sid(p),
      bucket: dayKey(new Date(now.getTime() - i * DAY)),
      views: Math.max(1, p.dailyViews + rStats.int(0, Math.max(1, Math.floor(p.dailyViews / 4)))),
    })),
  )
  for (const part of chunk(statRows, 500)) {
    await db
      .insert(s.seriesStatsDaily)
      .values(part)
      .onConflictDoUpdate({
        target: [s.seriesStatsDaily.seriesId, s.seriesStatsDaily.bucket],
        set: { views: sql`excluded.views` },
      })
  }

  // ---- bookmarks + ratings -----------------------------------------------------------
  const bookmarkRows = new Map<string, { userId: number; seriesId: number; status: string }>()
  const addBookmark = (userId: number, seriesId: number, status = 'reading') =>
    bookmarkRows.set(`${userId}:${seriesId}`, { userId, seriesId, status })
  for (const p of plans.slice(0, 8))
    addBookmark(readerId, sid(p), p.status === 'completed' ? 'completed' : 'reading')
  for (const p of plans.slice(0, 12)) addBookmark(premiumId, sid(p))
  for (const userId of readerIds)
    for (const p of rSocial.shuffle(plans).slice(0, rSocial.int(2, 10)))
      addBookmark(
        userId,
        sid(p),
        rSocial.pick(['reading', 'reading', 'planned', 'completed', 'paused']),
      )
  await db
    .insert(s.bookmarks)
    .values([...bookmarkRows.values()])
    .onConflictDoNothing()

  const ratingRows = new Map<string, { userId: number; seriesId: number; score: number }>()
  const addRating = (userId: number, seriesId: number, score: number) =>
    ratingRows.set(`${userId}:${seriesId}`, { userId, seriesId, score })
  for (const p of plans.slice(0, 6)) addRating(readerId, sid(p), rSocial.int(8, 10))
  for (const p of plans.slice(0, 10)) addRating(premiumId, sid(p), rSocial.int(7, 10))
  for (const userId of readerIds)
    for (const p of rSocial.shuffle(plans).slice(0, rSocial.int(1, 6)))
      addRating(userId, sid(p), rSocial.int(5, 10))
  await db
    .insert(s.ratings)
    .values([...ratingRows.values()])
    .onConflictDoNothing()

  // Catalog counters: the brief's ratings/bookmarks are far beyond what seed users can
  // produce, so the denormalised counters are set directly (the nightly reconcile would
  // log this as drift — expected for the dev seed).
  for (const p of plans) {
    if (!p.ratingTarget && p.bookmarkTarget === null) continue
    const set: Partial<typeof s.series.$inferInsert> = {}
    if (p.ratingTarget) {
      set.ratingCount = p.ratingTarget.count
      set.ratingSum = Math.round(p.ratingTarget.rating * p.ratingTarget.count)
    }
    if (p.bookmarkTarget !== null) set.bookmarkCount = p.bookmarkTarget
    await db
      .update(s.series)
      .set(set)
      .where(eq(s.series.id, sid(p)))
  }

  // reading progress for the "Continue Ch. 288" affordance
  const frostChapters = await db
    .select({ id: s.chapters.id, number: s.chapters.number })
    .from(s.chapters)
    .where(eq(s.chapters.seriesId, sid(frost)))
  const ch288 = frostChapters.find((c) => c.number === 288)
  if (ch288) {
    await db
      .insert(s.readingProgress)
      .values({
        userId: readerId,
        seriesId: sid(frost),
        chapterId: ch288.id,
        pageIdx: 3,
        scrollPct: 0.42,
        readAt: new Date(now.getTime() - 2 * DAY),
      })
      .onConflictDoNothing()
    await db
      .insert(s.chapterReads)
      .values(
        frostChapters
          .filter((c) => c.number <= 288 && c.number > 280)
          .map((c) => ({
            userId: readerId,
            chapterId: c.id,
            readAt: new Date(now.getTime() - 2 * DAY),
          })),
      )
      .onConflictDoNothing()
  }

  // ---- comments ----------------------------------------------------------------------
  let commentRows = 0
  const [{ existingComments } = { existingComments: 0 }] = await db
    .select({ existingComments: countFn() })
    .from(s.comments)
  if (Number(existingComments) === 0) {
    const popularPlans = plans.slice(0, 10)
    const latestIds = new Map(
      (
        await db
          .select({ seriesId: s.chapters.seriesId, id: sql<number>`max(${s.chapters.id})` })
          .from(s.chapters)
          .where(eq(s.chapters.state, 'published'))
          .groupBy(s.chapters.seriesId)
      ).map((c) => [c.seriesId, Number(c.id)]),
    )
    const topLevel: { id: number; seriesId: number; chapterId: number | null; createdAt: Date }[] =
      []
    for (const p of popularPlans) {
      const perSeries = p.catalogN === 1 ? 32 : 18
      const rows = Array.from({ length: perSeries }, (_, i) => {
        const spoiler = rComments.chance(0.12)
        const text = spoiler
          ? `Okay but ${rComments.pick(SPOILER_TEXTS)}.`
          : rComments.pick(COMMENT_TEXTS)
        const createdAt = new Date(now.getTime() - rComments.int(1, 30 * 24) * HOUR)
        const onChapter = i % 3 === 0 && latestIds.has(sid(p))
        return {
          userId: rComments.pick(commenterIds),
          seriesId: sid(p),
          chapterId: onChapter ? (latestIds.get(sid(p)) as number) : null,
          body: spoiler
            ? {
                type: 'doc' as const,
                version: 1 as const,
                children: [
                  {
                    type: 'paragraph',
                    children: [
                      { type: 'text', text: 'Okay but ' },
                      { type: 'spoiler', children: [{ type: 'text', text: text.slice(9, -1) }] },
                      { type: 'text', text: '.' },
                    ],
                  },
                ],
              }
            : bodyFromText(text),
          isSpoiler: spoiler,
          isPinned: false,
          status: 'published' as const,
          createdAt,
        }
      })
      const inserted = await db.insert(s.comments).values(rows).returning({
        id: s.comments.id,
        seriesId: s.comments.seriesId,
        chapterId: s.comments.chapterId,
        createdAt: s.comments.createdAt,
      })
      topLevel.push(
        ...inserted.map((c) => ({
          id: c.id,
          seriesId: c.seriesId as number,
          chapterId: c.chapterId,
          createdAt: c.createdAt,
        })),
      )
      commentRows += inserted.length
    }
    // one pinned staff comment on the series page subject
    const [pinned] = await db
      .insert(s.comments)
      .values({
        userId: uid('mod@palscans.org'),
        seriesId: sid(frost),
        body: bodyFromText(
          'Reminder: tag your spoilers for chapters released in the last 7 days. Untagged spoilers are removed.',
        ),
        isPinned: true,
        status: 'published',
        createdAt: new Date(now.getTime() - 3 * DAY),
      })
      .returning({ id: s.comments.id })
    if (pinned) commentRows += 1
    // replies
    const replies = topLevel
      .filter(() => rComments.chance(0.3))
      .map((parent) => ({
        userId: rComments.pick(commenterIds),
        seriesId: parent.seriesId,
        chapterId: parent.chapterId,
        parentId: parent.id,
        body: bodyFromText(rComments.pick(REPLY_TEXTS)),
        status: 'published' as const,
        createdAt: new Date(
          Math.min(now.getTime(), parent.createdAt.getTime() + rComments.int(1, 48) * HOUR),
        ),
      }))
    if (replies.length) {
      await db.insert(s.comments).values(replies)
      commentRows += replies.length
    }
    // a held comment with a link, so the moderation queue is not empty
    await db.insert(s.comments).values({
      userId: rComments.pick(readerIds),
      seriesId: sid(frost),
      body: bodyFromText('read ahead at frost-monarch-raws[dot]example'),
      status: 'pending',
      automodScore: 8,
      automodRules: ['new_account_24h', 'link_present'],
      hasLink: true,
      createdAt: new Date(now.getTime() - 40 * 60_000),
    })
    commentRows += 1
    // reactions
    const kinds: s.ReactionKind[] = [
      'up',
      'up',
      'up',
      'up',
      'funny',
      'love',
      'surprised',
      'angry',
      'sad',
    ]
    const reactionRows = new Map<string, { commentId: number; userId: number; kind: string }>()
    for (const c of topLevel) {
      for (const userId of rComments.shuffle(commenterIds).slice(0, rComments.int(0, 12))) {
        const kind = rComments.pick(kinds)
        reactionRows.set(`${c.id}:${userId}:${kind}`, { commentId: c.id, userId, kind })
      }
    }
    for (const part of chunk([...reactionRows.values()], 500))
      await db.insert(s.commentReactions).values(part).onConflictDoNothing()
  }
  log(`comments: +${commentRows}`)

  // ---- announcement, settings --------------------------------------------------------
  await db
    .insert(s.announcements)
    .values({
      slug: 'welcome-to-palscans',
      title: 'Welcome to the new PALScans',
      body: bodyFromText(
        'The new site is live: faster reader, bookmarks that sync, and comments on every chapter.\n\nPremium readers get early access on selected titles starting this week. Join the Discord for release pings.',
      ),
      excerpt:
        'The new site is live: faster reader, bookmarks that sync, and comments on every chapter.',
      authorId: adminId,
      state: 'published',
      tags: ['changelog'],
      publishedAt: new Date(now.getTime() - 2 * DAY),
    })
    .onConflictDoUpdate({
      target: s.announcements.slug,
      set: { title: sql`excluded.title`, body: sql`excluded.body` },
    })

  const settingRows: { key: string; value: unknown }[] = [
    { key: 'layouts', value: LAYOUTS },
    { key: 'ads', value: ADS },
    { key: 'comments', value: COMMENTS },
    { key: 'site', value: SITE },
    { key: 'home_layout', value: HOME_LAYOUT },
    { key: 'menus', value: MENUS },
  ]
  await db
    .insert(s.settings)
    .values(settingRows.map((row) => ({ ...row, updatedBy: adminId })))
    .onConflictDoNothing()
  await db
    .insert(s.commentSettings)
    .values(
      Object.entries(COMMENTS).map(([key, value]) => ({
        key,
        value: value === null ? sql`'null'::jsonb` : value,
      })),
    )
    .onConflictDoNothing()
  await db
    .insert(s.linkAllowlist)
    .values([
      { domain: 'palscans.org', createdBy: adminId },
      { domain: 'discord.gg', createdBy: adminId },
    ])
    .onConflictDoNothing()
  await db
    .insert(s.seoSettings)
    .values(Object.entries(SEO).map(([key, value]) => ({ key, value, updatedBy: adminId })))
    .onConflictDoNothing()
  await db
    .insert(s.featureFlags)
    .values([
      {
        key: 'reader.paged_mode',
        enabled: 'on',
        percentage: 100,
        description: 'Paged reader mode option',
      },
      {
        key: 'comments.images',
        enabled: 'on',
        percentage: 100,
        description: 'Community image collection in comments',
      },
      {
        key: 'push.notifications',
        enabled: 'off',
        percentage: 0,
        description: 'Web Push for bookmarked series',
      },
    ])
    .onConflictDoNothing()

  const [published] = await db
    .select({ id: s.appearanceSettings.id })
    .from(s.appearanceSettings)
    .where(eq(s.appearanceSettings.status, 'published'))
    .limit(1)
  if (!published) {
    await db.insert(s.appearanceSettings).values({
      settings: APPEARANCE,
      resolvedCss: resolveCss(DARK_TOKENS, LIGHT_TOKENS),
      status: 'published',
      publishedAt: now,
      createdBy: adminId,
    })
  }
  const [preset] = await db
    .select({ id: s.themePresets.id })
    .from(s.themePresets)
    .where(eq(s.themePresets.name, 'Violet Classic'))
    .limit(1)
  if (!preset) {
    await db
      .insert(s.themePresets)
      .values({ name: 'Violet Classic', settings: APPEARANCE, isBuiltin: true, createdBy: adminId })
  }

  await db
    .insert(s.pages)
    .values(
      [
        [
          'dmca',
          'DMCA',
          'Send takedown notices to dmca@palscans.org with the URLs in question. Notices are actioned within 48 hours.',
        ],
        ['terms', 'Terms of service', 'By using PALScans you agree to these terms.'],
        ['privacy', 'Privacy policy', 'We store what the site needs to work and nothing else.'],
        ['contact', 'Contact', 'Reach the team on Discord or at hello@palscans.org.'],
      ].map(([slug, title, text]) => ({
        slug: slug as string,
        title: title as string,
        body: bodyFromText(text as string),
        updatedBy: adminId,
      })),
    )
    .onConflictDoNothing()

  await db.insert(s.auditLog).values({
    actorId: adminId,
    action: 'seed.run',
    targetType: 'system',
    after: { generatedCount },
  })

  const [totals] = await db
    .select({
      genres: sql<number>`(select count(*) from ${s.genres})`,
      people: sql<number>`(select count(*) from ${s.people})`,
      users: sql<number>`(select count(*) from ${s.users})`,
      series: sql<number>`(select count(*) from ${s.series})`,
      chapters: sql<number>`(select count(*) from ${s.chapters})`,
      chapterPages: sql<number>`(select count(*) from ${s.chapterPages})`,
      comments: sql<number>`(select count(*) from ${s.comments})`,
      bookmarks: sql<number>`(select count(*) from ${s.bookmarks})`,
      ratings: sql<number>`(select count(*) from ${s.ratings})`,
    })
    .from(sql`(select 1) as one`)
  const result = Object.fromEntries(
    Object.entries(totals ?? {}).map(([k, v]) => [k, Number(v)]),
  ) as unknown as SeedResult
  log(`done: ${JSON.stringify(result)}`)
  return result
}
