import { can, showsAds } from '@palscans/core'
import { fmt, messages } from '@palscans/core/messages'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { preload } from 'react-dom'
import { ChapterComments } from '@/components/reader/ChapterComments'
import { ChapterJsonLd } from '@/components/reader/ChapterJsonLd'
import { LockedGate } from '@/components/reader/LockedGate'
import {
  chapterHref,
  formatChapterNumber,
  parseChapterSegment,
  seriesHref,
} from '@/components/reader/params'
import { Reader } from '@/components/reader/Reader'
import {
  type ChapterListEntry,
  lockOf,
  readerChapter,
  readerChapterList,
  readerResume,
  readerSeries,
  storageUrl,
  toReaderPages,
  viewerCanRead,
} from '@/components/reader/server/data'
import { chapterJsonLd, chapterMetadata } from '@/components/reader/server/seo'
import { cachedReaderSiteSettings } from '@/components/reader/server/settings'
import type { ChapterLink, ReaderData } from '@/components/reader/types'
import { getSessionUser } from '@/lib/auth/session'

interface PageProps {
  params: Promise<{ slug: string; chapter: string }>
}

/**
 * /series/[slug]/chapter-[n] (docs/12 §1). Next cannot route a partial segment such as
 * `chapter-[n]`, so the folder is `[chapter]` and anything that is not `chapter-<number>`
 * is a 404 here.
 */
const load = async (params: PageProps['params']) => {
  const { slug, chapter } = await params
  const number = parseChapterSegment(chapter)
  if (number === null) return null
  const user = await getSessionUser()
  const staff = can(user, 'chapter.read')
  const series = await readerSeries(slug, staff)
  if (!series) return null
  const bundle = await readerChapter(series.id, number, staff)
  if (!bundle) return null
  return { user, staff, series, bundle }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const ctx = await load(params)
  if (!ctx) return { title: messages.errors.notFound }
  const now = new Date()
  const readable = viewerCanRead(ctx.user, ctx.bundle.chapter, now)
  const first = ctx.bundle.pages[0]
  return chapterMetadata({
    series: ctx.series,
    bundle: ctx.bundle,
    firstPageUrl: readable && first ? storageUrl(first.key) : null,
    coverUrl: ctx.series.coverKey ? storageUrl(ctx.series.coverKey) : null,
  })
}

const chapterLabel = (n: number) =>
  fmt(messages.readerUi.chapterTitle, { n: formatChapterNumber(n) })

const toLink = (slug: string, c: ChapterListEntry): ChapterLink => ({
  number: c.number,
  label: chapterLabel(c.number),
  href: chapterHref(slug, c.number),
  locked: c.lock !== 'none',
})

export default async function ChapterPage({ params }: PageProps) {
  const ctx = await load(params)
  if (!ctx) notFound()
  const { user, series, bundle } = ctx
  const now = new Date()
  const readable = viewerCanRead(user, bundle.chapter, now)
  const [list, site] = await Promise.all([
    readerChapterList(series.id, now),
    cachedReaderSiteSettings(),
  ])
  const links = list.map((c) => toLink(series.slug, c))
  const byNumber = new Map(links.map((l) => [l.number, l]))
  const prev = bundle.prev ? (byNumber.get(bundle.prev.number) ?? null) : null
  const next = bundle.next ? (byNumber.get(bundle.next.number) ?? null) : null
  const number = formatChapterNumber(bundle.chapter.number)
  const label = chapterLabel(bundle.chapter.number)
  const here = chapterHref(series.slug, bundle.chapter.number)
  const returnTo = encodeURIComponent(here)
  const subscribe = `/subscribe?return=${returnTo}`
  const signIn = `/login?next=${returnTo}`
  const coverUrl = series.coverKey ? storageUrl(series.coverKey) : null
  const relLinks = (
    <>
      {prev ? <link rel="prev" href={prev.href} /> : null}
      {next ? <link rel="next" href={next.href} /> : null}
    </>
  )

  if (!readable) {
    const lock = lockOf(bundle.chapter, now)
    return (
      <>
        {relLinks}
        <ChapterJsonLd data={chapterJsonLd({ series, bundle, firstPageUrl: null, coverUrl })} />
        <LockedGate
          seriesTitle={series.title}
          seriesHref={seriesHref(series.slug)}
          coverUrl={coverUrl}
          coverColor={series.coverColor}
          chapterLabel={label}
          lock={lock === 'none' ? 'premium' : lock}
          freeAt={lock === 'early_access' ? bundle.chapter.earlyAccessUntil : null}
          now={now}
          prev={prev}
          next={next}
          signedIn={!!user}
          subscribeHref={subscribe}
          signInHref={signIn}
        />
      </>
    )
  }

  const pages = toReaderPages(bundle.pages)
  const first = pages[0]
  if (first) preload(first.url, { as: 'image', fetchPriority: 'high' })
  const resume = await readerResume(user, series.id, bundle.chapter.id)
  const noAds = !showsAds(user, now)
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
      placeholder: site.endTag === null,
    },
    viewer: { signedIn: !!user, resume },
    links: { subscribe, signIn },
    nextPagesEndpoint:
      bundle.next && next && !next.locked ? `/api/chapters/${bundle.next.id}/pages?limit=3` : null,
  }

  const summary = bundle.chapter.publishedAt
    ? fmt(messages.readerUi.summary, {
        chapter: number,
        title: series.title,
        date: bundle.chapter.publishedAt.slice(0, 10),
      })
    : null

  return (
    <>
      {relLinks}
      <ChapterJsonLd
        data={chapterJsonLd({ series, bundle, firstPageUrl: first?.url ?? null, coverUrl })}
      />
      {/* docs/12 §3: H1, breadcrumb, prev/next anchor text and a one-line summary are in the HTML for crawlers. */}
      <div className="sr-only">
        <h1>{`${series.title} ${label}`}</h1>
        <nav aria-label={messages.discovery.breadcrumbs}>
          <a href="/">{messages.readerUi.breadcrumbHome}</a> ·{' '}
          <a href={seriesHref(series.slug)}>{series.title}</a> · {label}
        </nav>
        {summary ? (
          <p>
            {summary}{' '}
            {bundle.chapter.publishedAt ? (
              <time dateTime={bundle.chapter.publishedAt}>
                {bundle.chapter.publishedAt.slice(0, 10)}
              </time>
            ) : null}
          </p>
        ) : null}
        {prev ? <a href={prev.href}>{`${messages.reader.prevChapter}: ${prev.label}`}</a> : null}
        {next ? <a href={next.href}>{`${messages.reader.nextChapter}: ${next.label}`}</a> : null}
      </div>
      <Reader
        data={data}
        comments={
          <ChapterComments chapterId={bundle.chapter.id} enabled={series.commentsEnabled} />
        }
      />
    </>
  )
}
