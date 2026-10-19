import type { SessionUser } from '@palscans/core'
import { type ChapterLock, can } from '@palscans/core'
import { chapterLanguage, DEFAULT_CHAPTER_LANGUAGE } from '@palscans/core/languages'
import { localeChapterLabel } from '@palscans/core/locale'
import { fmt, messages } from '@palscans/core/messages'
import type { EntitlementGate } from '@/lib/entitlements'
import { chapterHref, formatChapterNumber, seriesHref } from '../params'
import type { ChapterLink, ReaderData, ReaderPage } from '../types'
import {
  type ChapterBundle,
  type ChapterListEntry,
  lockOf,
  readerResume,
  storageUrl,
  toReaderPages,
} from './data'
import type { ReaderSiteSettings } from './settings'

/**
 * "Chapter 1196" — or "Kapitel 1196" on the German translation of it.
 *
 * The reader's own label rather than the operator's chapter-label style: inside a chapter,
 * "Ch. 1196" and "#1196" are too terse for the one line that says where you are.
 */
export const chapterLabel = (n: number, language?: string | null) =>
  localeChapterLabel(language, formatChapterNumber(n))

export const toLink = (
  slug: string,
  c: ChapterListEntry,
  locked: boolean,
  language?: string,
): ChapterLink => ({
  number: c.number,
  label: chapterLabel(c.number, language),
  // Carrying the language here is what keeps a German reader in German: every chapter link
  // on the page — prev, next and the whole select — is built from this one function.
  href: chapterHref(slug, c.number, language),
  locked,
})

/** docs/17 §B: a chapter shows a lock only where *this* viewer is actually locked out. */
export const lockedForViewer = (
  gate: EntitlementGate,
  user: SessionUser | null,
  now: Date,
  lock: ChapterLock,
): boolean => {
  switch (lock) {
    case 'early_access':
      return !gate.can('early_access', user, now)
    case 'premium':
      return !gate.can('premium_content', user, now)
    case 'unpublished':
      return !can(user, 'chapter.read')
    default:
      return false
  }
}

export interface ReaderSeriesRow {
  id: number
  slug: string
  title: string
  type: string
  coverKey: string | null
  readingDirection: 'ltr' | 'rtl' | 'vertical'
}

export interface BuildReaderDataArgs {
  /** The translation being read; every link built below stays in it. */
  language?: string
  /** Every translation of this series, and whether it has the number being read. */
  languages?: Array<{ language: string; chapters: number; hasThisNumber: boolean }>
  user: SessionUser | null
  series: ReaderSeriesRow
  bundle: ChapterBundle
  list: ChapterListEntry[]
  gate: EntitlementGate
  site: ReaderSiteSettings
  now: Date
  /** Pre-resolved pages, so the page route can `preload()` the first one before building. */
  pages?: ReaderPage[]
}

export interface BuiltReaderData {
  data: ReaderData
  pages: ReaderPage[]
  coverUrl: string | null
  prev: ChapterLink | null
  next: ChapterLink | null
  label: string
  number: string
  here: string
}

/**
 * Everything the reader island needs, assembled once (docs/06). Shared by the chapter route
 * and `GET /api/chapters/:id/offline`, which must hand the downloader *exactly* what the
 * online reader would render — a download that differs from the page is a bug nobody sees
 * until the reader is on a train.
 */
export const buildReaderData = async (args: BuildReaderDataArgs): Promise<BuiltReaderData> => {
  const { user, series, bundle, list, gate, site, now } = args
  const language = args.language ?? DEFAULT_CHAPTER_LANGUAGE
  const links = list.map((c) =>
    toLink(series.slug, c, lockedForViewer(gate, user, now, c.lock), args.language),
  )
  const byNumber = new Map(links.map((l) => [l.number, l]))
  const prev = bundle.prev ? (byNumber.get(bundle.prev.number) ?? null) : null
  const next = bundle.next ? (byNumber.get(bundle.next.number) ?? null) : null
  const number = formatChapterNumber(bundle.chapter.number)
  const label = chapterLabel(bundle.chapter.number, language)
  // In the chapter's own language: this is what `returnTo` sends a reader back to after a
  // sign-in, and sending a German reader back to the English page is a small betrayal.
  const here = chapterHref(series.slug, bundle.chapter.number, language)
  const returnTo = encodeURIComponent(here)
  const coverUrl = series.coverKey ? storageUrl(series.coverKey) : null
  const pages = args.pages ?? (await toReaderPages(bundle.pages, lockOf(bundle.chapter, now)))
  const resume = await readerResume(user, series.id, bundle.chapter.id)
  const noAds = !gate.showsAds(user, now)
  const [w, h] = site.ads.sky_size === '300x600' ? [300, 600] : [160, 600]

  const data: ReaderData = {
    series: {
      id: series.id,
      slug: series.slug,
      title: series.title,
      href: seriesHref(series.slug),
      readingDirection: series.readingDirection,
      type: series.type,
      coverSrc: coverUrl,
    },
    chapter: {
      id: bundle.chapter.id,
      number: bundle.chapter.number,
      label,
      // `Kapitel 1196: Der Titel` on a German chapter — the separator is punctuation, so
      // the label carries the language and the chapter's own title is left as written.
      labelWithTitle: bundle.chapter.title ? `${label}: ${bundle.chapter.title}` : label,
      title: bundle.chapter.title,
      href: here,
      altTemplate: fmt(messages.reader.pageAlt, { title: series.title, chapter: number }),
    },
    pages,
    prev,
    next,
    chapters: links,
    language,
    // Each entry links to the *same chapter number* in that language when it exists, so
    // switching language keeps your place instead of dumping you at chapter 1. When that
    // number has no translation, the series page is the honest destination.
    languages: (args.languages ?? [])
      .filter((l) => l.chapters > 0)
      .map((l) => ({
        code: l.language,
        native: chapterLanguage(l.language).native,
        href:
          l.language === language
            ? here
            : l.hasThisNumber
              ? chapterHref(series.slug, bundle.chapter.number, l.language)
              : `/series/${series.slug}${
                  l.language === DEFAULT_CHAPTER_LANGUAGE ? '' : `?lang=${l.language}`
                }`,
      })),
    defaults: { mode: site.layout.default_mode, background: site.layout.background },
    ads: {
      enabled: !noAds,
      skyscrapers: site.ads.skyscrapers,
      skySize: { w: w === 300 ? 300 : 160, h: h === 600 ? 600 : 600 },
      mobileInterval: site.ads.mobile_interval,
      endSlot: site.ads.end_slot,
      placeholder: site.tags.end === null,
      tags: site.tags,
    },
    viewer: { signedIn: !!user, userId: user?.id ?? null, resume },
    links: { subscribe: `/subscribe?return=${returnTo}`, signIn: `/login?next=${returnTo}` },
    nextPagesEndpoint:
      bundle.next && next && !next.locked ? `/api/chapters/${bundle.next.id}/pages?limit=3` : null,
  }

  return { data, pages, coverUrl, prev, next, label, number, here }
}
