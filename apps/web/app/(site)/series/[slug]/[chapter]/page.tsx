import { can } from '@palscans/core'
import { fmt, messages } from '@palscans/core/messages'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { preload } from 'react-dom'
import { ChapterComments } from '@/components/reader/ChapterComments'
import { ChapterJsonLd } from '@/components/reader/ChapterJsonLd'
import { LockedGate } from '@/components/reader/LockedGate'
import { chapterHref, parseChapterSegment, seriesHref } from '@/components/reader/params'
import { Reader } from '@/components/reader/Reader'
import {
  lockOf,
  readerChapter,
  readerChapterList,
  readerSeries,
  storageUrl,
  toReaderPages,
  viewerCanRead,
} from '@/components/reader/server/data'
import {
  buildReaderData,
  chapterLabel,
  lockedForViewer,
  toLink,
} from '@/components/reader/server/payload'
import { chapterJsonLd, chapterMetadata } from '@/components/reader/server/seo'
import { cachedReaderSiteSettings } from '@/components/reader/server/settings'
import { ViewBeacon } from '@/components/views/ViewBeacon'
import { getSessionUser } from '@/lib/auth/session'
import { entitlementGate } from '@/lib/entitlements'

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
  const gate = await entitlementGate()
  const readable = viewerCanRead(ctx.user, ctx.bundle.chapter, { overrides: gate.overrides, now })
  const first = ctx.bundle.pages[0]
  // Locked chapters never put a page URL in the metadata, entitled viewer or not.
  const free = readable && lockOf(ctx.bundle.chapter, now) === 'none'
  return chapterMetadata({
    series: ctx.series,
    bundle: ctx.bundle,
    firstPageUrl: free && first ? storageUrl(first.key) : null,
    coverUrl: ctx.series.coverKey ? storageUrl(ctx.series.coverKey) : null,
  })
}

export default async function ChapterPage({ params }: PageProps) {
  const ctx = await load(params)
  if (!ctx) notFound()
  const { user, series, bundle } = ctx
  const now = new Date()
  const [gate, list, site] = await Promise.all([
    entitlementGate(),
    readerChapterList(series.id, now),
    cachedReaderSiteSettings(),
  ])
  const readable = viewerCanRead(user, bundle.chapter, { overrides: gate.overrides, now })
  const lock = lockOf(bundle.chapter, now)

  if (!readable) {
    const links = list.map((c) => toLink(series.slug, c, lockedForViewer(gate, user, now, c.lock)))
    const byNumber = new Map(links.map((l) => [l.number, l]))
    const prev = bundle.prev ? (byNumber.get(bundle.prev.number) ?? null) : null
    const next = bundle.next ? (byNumber.get(bundle.next.number) ?? null) : null
    const label = chapterLabel(bundle.chapter.number)
    const returnTo = encodeURIComponent(chapterHref(series.slug, bundle.chapter.number))
    const coverUrl = series.coverKey ? storageUrl(series.coverKey) : null
    return (
      <>
        {prev ? <link rel="prev" href={prev.href} /> : null}
        {next ? <link rel="next" href={next.href} /> : null}
        {/* A paywall gate is not a read of the chapter, but it is still interest in the
            series, so it counts as a series-page view (chapter_id 0). */}
        <ViewBeacon seriesId={series.id} />
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
          subscribeHref={`/subscribe?return=${returnTo}`}
          signInHref={`/login?next=${returnTo}`}
        />
      </>
    )
  }

  const pages = await toReaderPages(bundle.pages, lock)
  const first = pages[0]
  if (first) preload(first.url, { as: 'image', fetchPriority: 'high' })
  const { data, coverUrl, prev, next, label, number } = await buildReaderData({
    user,
    series,
    bundle,
    list,
    gate,
    site,
    now,
    pages,
  })
  const relLinks = (
    <>
      {prev ? <link rel="prev" href={prev.href} /> : null}
      {next ? <link rel="next" href={next.href} /> : null}
    </>
  )

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
      {/* docs/02 "Views and ranking": reported by the browser after a moment on the page. */}
      <ViewBeacon seriesId={series.id} chapterId={bundle.chapter.id} />
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
