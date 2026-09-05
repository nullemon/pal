import type { SessionUser } from '@palscans/core'
import { type ChapterLock, can } from '@palscans/core'
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

export const chapterLabel = (n: number) =>
  fmt(messages.readerUi.chapterTitle, { n: formatChapterNumber(n) })

export const toLink = (slug: string, c: ChapterListEntry, locked: boolean): ChapterLink => ({
  number: c.number,
  label: chapterLabel(c.number),
  href: chapterHref(slug, c.number),
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
  coverKey: string | null
  readingDirection: 'ltr' | 'rtl' | 'vertical'
}

export interface BuildReaderDataArgs {
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
  const links = list.map((c) => toLink(series.slug, c, lockedForViewer(gate, user, now, c.lock)))
  const byNumber = new Map(links.map((l) => [l.number, l]))
  const prev = bundle.prev ? (byNumber.get(bundle.prev.number) ?? null) : null
  const next = bundle.next ? (byNumber.get(bundle.next.number) ?? null) : null
  const number = formatChapterNumber(bundle.chapter.number)
  const label = chapterLabel(bundle.chapter.number)
  const here = chapterHref(series.slug, bundle.chapter.number)
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
    },
    chapter: {
      id: bundle.chapter.id,
      number: bundle.chapter.number,
      label,
      labelWithTitle: bundle.chapter.title
        ? fmt(messages.readerUi.chapterWithTitle, { n: number, title: bundle.chapter.title })
        : label,
      title: bundle.chapter.title,
      href: here,
      altTemplate: fmt(messages.reader.pageAlt, { title: series.title, chapter: number }),
    },
    pages,
    prev,
    next,
    chapters: links,
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
    viewer: { signedIn: !!user, resume },
    links: { subscribe: `/subscribe?return=${returnTo}`, signIn: `/login?next=${returnTo}` },
    nextPagesEndpoint:
      bundle.next && next && !next.locked ? `/api/chapters/${bundle.next.id}/pages?limit=3` : null,
  }

  return { data, pages, coverUrl, prev, next, label, number, here }
}
