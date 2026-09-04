/**
 * The docs/09 mapping, as pure functions. Nothing here touches a database on either side:
 * a legacy row goes in, a plain object shaped like the new schema comes out, and the caller
 * (the worker job, the dry run) decides what to do with it.
 */

import type { CommentBody } from '../comments/body.js'
import { slugify } from '../slug.js'
import { parseChapterNumber } from './chapter-number.js'
import { htmlToCommentBody } from './comment-html.js'
import { readMetaValue } from './php-serialize.js'
import type { LegacyChapter, LegacyComment, LegacyPost, LegacyTerm, LegacyUser } from './source.js'

export type SeriesType = 'manga' | 'manhwa' | 'manhua' | 'comic' | 'novel'
export type SeriesStatus = 'ongoing' | 'completed' | 'hiatus' | 'cancelled' | 'dropped'
export type PubState = 'draft' | 'published' | 'removed'
export type UserRole = 'user' | 'supporter' | 'premium' | 'uploader' | 'moderator' | 'admin'
export type CommentStatus = 'published' | 'pending' | 'rejected' | 'removed'

/** The legacy post type carrying a series. */
export const SERIES_POST_TYPE = 'wp-manga'
/** The legacy post type carrying a reader's bookmark. */
export const BOOKMARK_POST_TYPE = 'manga-bookmark'

/** The taxonomies docs/09 pins, and where each one lands. */
export const TAXONOMIES = {
  'wp-manga-genre': 'genre',
  'wp-manga-tag': 'tag',
  'wp-manga-author': 'author',
  'wp-manga-artist': 'artist',
  'wp-manga-release': 'release',
} as const
export type TaxonomyRole = (typeof TAXONOMIES)[keyof typeof TAXONOMIES]

/** The meta keys docs/09 pins — also the checklist `discover()` reports against. */
export const META_KEYS = [
  'manga_unique_id',
  '_wp_manga_type',
  '_wp_manga_status',
  '_wp_manga_alternative',
  '_wp_manga_views',
  '_wp_manga_day_views',
  '_wp_manga_week_views',
  '_wp_manga_month_views',
  '_wp_manga_year_views',
  '_manga_reviews',
  '_manga_avarage_reviews',
  'manga_title_badges',
  '_thumbnail_id',
  '_bookmark_data',
  '_bookmark_time',
] as const

const TYPE_MAP: Record<string, SeriesType> = {
  manga: 'manga',
  manhwa: 'manhwa',
  manhua: 'manhua',
  comic: 'comic',
  comics: 'comic',
  novel: 'novel',
  'light-novel': 'novel',
  webtoon: 'manhwa',
  korean: 'manhwa',
  chinese: 'manhua',
  japanese: 'manga',
}

const STATUS_MAP: Record<string, SeriesStatus> = {
  'on-going': 'ongoing',
  ongoing: 'ongoing',
  publishing: 'ongoing',
  upcoming: 'ongoing',
  end: 'completed',
  completed: 'completed',
  complete: 'completed',
  finished: 'completed',
  'on-hold': 'hiatus',
  hiatus: 'hiatus',
  canceled: 'cancelled',
  cancelled: 'cancelled',
  dropped: 'dropped',
}

const ROLE_MAP: Record<string, UserRole> = {
  administrator: 'admin',
  editor: 'moderator',
  author: 'uploader',
  contributor: 'uploader',
  subscriber: 'user',
}

const num = (raw: string | undefined, fallback = 0): number => {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? n : fallback
}

const int = (raw: string | undefined, fallback = 0): number => Math.trunc(num(raw, fallback))

/** `post_date_gmt` is `YYYY-MM-DD HH:MM:SS` in UTC; normalise to an ISO instant. */
export const legacyDate = (raw: string | null | undefined): string | null => {
  if (!raw) return null
  const s = raw.trim()
  if (s === '' || s.startsWith('0000-00-00')) return null
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Strip the theme's HTML down to the plain synopsis the new schema stores. */
export const stripHtml = (html: string): string =>
  html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

export interface MappedTerm {
  slug: string
  name: string
  role: TaxonomyRole
}

export interface MappedSeries {
  /** `wp_posts.ID`. */
  legacyId: number
  /** `manga_unique_id` — the idempotency key the import runs against (docs/09). */
  uniqueId: string
  /** True when the post had no `manga_unique_id` and the id was synthesised from the post id. */
  synthesisedUniqueId: boolean
  slug: string
  title: string
  synopsis: string | null
  type: SeriesType
  status: SeriesStatus
  state: PubState
  altTitles: string[]
  genres: MappedTerm[]
  people: { slug: string; name: string; credit: 'author' | 'artist' }[]
  releasedYear: number | null
  viewCount: number
  periodViews: { day: number; week: number; month: number; year: number }
  ratingCount: number
  ratingSum: number
  ratingAvg: number
  badges: string[]
  coverAttachmentId: number | null
  createdAt: string | null
  publishedAt: string | null
  deleted: boolean
  /** Legacy warnings for the dry-run report (unknown type/status, missing slug…). */
  warnings: string[]
}

const termsOf = (post: LegacyPost, role: TaxonomyRole): MappedTerm[] =>
  post.terms
    .filter((t) => TAXONOMIES[t.taxonomy as keyof typeof TAXONOMIES] === role)
    .map((t) => ({ slug: slugify(t.slug || t.name, { fallback: '' }), name: t.name.trim(), role }))
    .filter((t) => t.slug !== '')

/** `wp_posts` (post_type=wp-manga) + its meta and taxonomies → the `series` row. */
export const mapSeries = (post: LegacyPost): MappedSeries => {
  const warnings: string[] = []
  const meta = post.meta
  const rawType = (meta._wp_manga_type ?? '').trim().toLowerCase()
  const type = TYPE_MAP[rawType]
  if (!type && rawType !== '') warnings.push(`unknown _wp_manga_type "${rawType}" → manga`)
  const rawStatus = (meta._wp_manga_status ?? '').trim().toLowerCase()
  const status = STATUS_MAP[rawStatus]
  if (!status && rawStatus !== '')
    warnings.push(`unknown _wp_manga_status "${rawStatus}" → ongoing`)

  const uniqueRaw = (meta.manga_unique_id ?? '').trim()
  if (uniqueRaw === '') warnings.push('no manga_unique_id — keyed on the post id instead')
  const slug = slugify(post.name || post.title)
  if (post.name.trim() === '') warnings.push('no post_name — slug derived from the title')

  const alt = (meta._wp_manga_alternative ?? '')
    .split(/[,;|]|\r?\n/)
    .map((t) => t.trim())
    .filter((t) => t !== '' && t.toLowerCase() !== post.title.trim().toLowerCase())

  const release = termsOf(post, 'release')[0]
  const year = release ? Number.parseInt(release.name.replace(/\D+/g, ''), 10) : Number.NaN

  const ratingCount = int(meta._manga_reviews)
  const ratingAvg = num(meta._manga_avarage_reviews)

  const badgesRaw = readMetaValue(meta.manga_title_badges)
  const badges = Array.isArray(badgesRaw)
    ? badgesRaw.map((b) => String(b)).filter((b) => b !== '')
    : typeof badgesRaw === 'string' && badgesRaw !== ''
      ? badgesRaw
          .split(',')
          .map((b) => b.trim())
          .filter((b) => b !== '')
      : []

  const thumb = int(meta._thumbnail_id, 0)
  const state: PubState =
    post.status === 'publish' ? 'published' : post.status === 'trash' ? 'removed' : 'draft'

  return {
    legacyId: post.id,
    uniqueId: uniqueRaw === '' ? `wp-post-${post.id}` : uniqueRaw,
    synthesisedUniqueId: uniqueRaw === '',
    slug,
    title: post.title.trim(),
    synopsis: stripHtml(post.content) || null,
    type: type ?? 'manga',
    status: status ?? 'ongoing',
    state,
    altTitles: [...new Set(alt)],
    genres: [...termsOf(post, 'genre'), ...termsOf(post, 'tag')],
    people: [
      ...termsOf(post, 'author').map((t) => ({ ...t, credit: 'author' as const })),
      ...termsOf(post, 'artist').map((t) => ({ ...t, credit: 'artist' as const })),
    ].map(({ slug: s, name, credit }) => ({ slug: s, name, credit })),
    releasedYear: Number.isNaN(year) ? null : year,
    viewCount: int(meta._wp_manga_views),
    periodViews: {
      day: int(meta._wp_manga_day_views),
      week: int(meta._wp_manga_week_views),
      month: int(meta._wp_manga_month_views),
      year: int(meta._wp_manga_year_views),
    },
    ratingCount,
    // The new schema keeps a sum out of 10 per vote; the theme stores a 1–5 average.
    ratingSum: Math.round(ratingAvg * 2 * ratingCount),
    ratingAvg: Math.round(ratingAvg * 2 * 10) / 10,
    badges,
    coverAttachmentId: thumb > 0 ? thumb : null,
    createdAt: legacyDate(post.dateGmt),
    publishedAt: state === 'published' ? legacyDate(post.dateGmt) : null,
    deleted: post.status === 'trash',
    warnings,
  }
}

export interface MappedChapterPage {
  idx: number
  path: string
  attachmentId: number | null
}

export interface MappedChapter {
  legacyId: number
  seriesLegacyId: number
  seriesUniqueId?: string
  /** numeric(10,3) as a string, or null when the display name needs a human (review CSV). */
  number: string | null
  title: string | null
  volume: number | null
  /** The legacy URL segment, e.g. `chapter-154`. */
  legacySlug: string | null
  rawName: string
  createdAt: string | null
  pages: MappedChapterPage[]
}

/** `wp_manga_chapters` → the `chapters` row, with the display name parsed strictly. */
export const mapChapter = (chapter: LegacyChapter, seriesUniqueId?: string): MappedChapter => {
  const parsed = parseChapterNumber(chapter.name)
  const volFromName = chapter.volumeName
    ? Number.parseInt(chapter.volumeName.replace(/\D+/g, ''), 10)
    : Number.NaN
  return {
    legacyId: chapter.chapterId,
    seriesLegacyId: chapter.seriesPostId,
    ...(seriesUniqueId === undefined ? {} : { seriesUniqueId }),
    number: parsed.number,
    title: parsed.title,
    volume: parsed.volume ?? (Number.isNaN(volFromName) ? null : volFromName),
    legacySlug: chapter.slug?.trim() || null,
    rawName: chapter.name,
    createdAt: legacyDate(chapter.createdAt),
    pages: [...chapter.pages]
      .sort((a, b) => a.idx - b.idx)
      .map((p, i) => ({ idx: i, path: p.path, attachmentId: p.attachmentId ?? null })),
  }
}

export interface MappedUser {
  legacyId: number
  email: string
  username: string
  displayName: string | null
  /**
   * Always null: phpass is never converted (docs/09). Nothing here mails the user — the only
   * way back into an imported account is the reader starting "forgot password" themselves,
   * which works because `/api/auth/forgot-password` does not require an existing hash.
   */
  passwordHash: null
  role: UserRole
  createdAt: string | null
  emailVerifiedAt: string | null
}

/** `wp_users` → the `users` row. The password hash is deliberately dropped. */
export const mapUser = (user: LegacyUser): MappedUser => {
  const username = slugify(user.login || user.displayName || `user-${user.id}`, {
    maxLength: 32,
    fallback: '',
  })
  const created = legacyDate(user.registered)
  return {
    legacyId: user.id,
    email: user.email.trim().toLowerCase(),
    username: username === '' ? `user-${user.id}` : username,
    displayName: user.displayName?.trim() || null,
    passwordHash: null,
    role: ROLE_MAP[(user.role ?? '').trim().toLowerCase()] ?? 'user',
    createdAt: created,
    // The legacy site had no verification step; treat a registered account as verified.
    emailVerifiedAt: created,
  }
}

export interface MappedComment {
  legacyId: number
  legacyPostId: number
  legacyParentId: number | null
  legacyUserId: number | null
  authorName: string
  body: CommentBody
  status: CommentStatus
  createdAt: string | null
}

/** `wp_comments` on a `wp-manga` post → the `comments` row, HTML converted to the JSON body. */
export const mapComment = (comment: LegacyComment): MappedComment => ({
  legacyId: comment.id,
  legacyPostId: comment.postId,
  legacyParentId: comment.parentId > 0 ? comment.parentId : null,
  legacyUserId: comment.userId > 0 ? comment.userId : null,
  authorName: comment.authorName.trim(),
  body: htmlToCommentBody(comment.content),
  status:
    comment.approved === '1'
      ? 'published'
      : comment.approved === 'spam'
        ? 'rejected'
        : comment.approved === 'trash'
          ? 'removed'
          : 'pending',
  createdAt: legacyDate(comment.dateGmt),
})

export interface MappedBookmark {
  legacyId: number
  legacyUserId: number
  /** `wp_posts.ID` of the bookmarked series. */
  seriesLegacyId: number | null
  status: 'reading' | 'planned' | 'completed' | 'paused' | 'dropped'
  createdAt: string | null
}

const BOOKMARK_STATUS: Record<string, MappedBookmark['status']> = {
  reading: 'reading',
  'plan-to-read': 'planned',
  planned: 'planned',
  completed: 'completed',
  'on-hold': 'paused',
  paused: 'paused',
  dropped: 'dropped',
}

/** `post_type='manga-bookmark'` + `_bookmark_data` → the `bookmarks` row. */
export const mapBookmark = (post: LegacyPost): MappedBookmark => {
  const data = readMetaValue(post.meta._bookmark_data)
  const bag = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  const seriesId = Number.parseInt(String(bag.post_id ?? bag.manga_id ?? post.parent ?? ''), 10)
  const status = String(bag.status ?? bag.reading_status ?? 'reading').toLowerCase()
  return {
    legacyId: post.id,
    legacyUserId: post.authorId,
    seriesLegacyId: Number.isNaN(seriesId) || seriesId <= 0 ? null : seriesId,
    status: BOOKMARK_STATUS[status] ?? 'reading',
    createdAt: legacyDate(post.meta._bookmark_time ?? post.dateGmt),
  }
}

/** A `wp_terms` row → a `genres` or `people` row, depending on its taxonomy. */
export const mapTerm = (term: LegacyTerm): MappedTerm | null => {
  const role = TAXONOMIES[term.taxonomy as keyof typeof TAXONOMIES]
  if (!role) return null
  const slug = slugify(term.slug || term.name, { fallback: '' })
  return slug === '' ? null : { slug, name: term.name.trim(), role }
}
