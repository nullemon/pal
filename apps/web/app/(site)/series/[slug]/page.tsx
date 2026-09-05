import { renderSeo, truncateWords } from '@palscans/core'
import { fmt, messages } from '@palscans/core/messages'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ViewBeacon } from '@/components/views/ViewBeacon'
import { storageUrl } from '@/lib/comments/media'
import { getEnv } from '@/lib/env'
import { seriesLayout } from '@/lib/layouts/series'
import { OG_HEIGHT, OG_WIDTH } from '@/lib/seo/og-card'
import { ogSeriesBySlug, seriesOgUrl } from '@/lib/seo/og-data'
import { chapterRows, getSeries } from './data'
import { loadSeriesView } from './view'

/**
 * The series share card as an absolute URL, or null when the row is not readable from here.
 * Metadata never fails over an image: the caller falls back to the stored cover.
 */
const ogSeriesCard = async (slug: string): Promise<string | null> => {
  try {
    const row = await ogSeriesBySlug(slug)
    if (!row) return null
    return new URL(seriesOgUrl(row), getEnv().SITE_URL).toString()
  } catch {
    return null
  }
}

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** docs/12 §2 — title/description templates with per-series overrides, canonical, OG/Twitter, robots. */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const series = await getSeries(slug)
  if (!series) return { title: messages.errors.notFound }
  const env = getEnv()
  const chapters = await chapterRows(series.id, null, new Date())
  const latest = chapters[0]
  const seo = renderSeo('series', {
    site: env.SITE_NAME,
    title: series.title,
    type: messages.series.type[series.type],
    chapter_count: series.chapterCount,
    latest_chapter: latest ? fmt(messages.series.chapterShort, { n: latest.number }) : '',
    genres: series.genres.map((g) => g.name).join(', '),
    author: series.people.find((p) => p.credit === 'author')?.name ?? '',
    year: series.releasedYear ?? '',
    synopsis: series.synopsis ?? '',
  })
  const title = series.seoTitle ?? seo.title
  const description = series.seoDescription ?? seo.description
  const canonical = series.canonicalUrl ?? `${env.SITE_URL}/series/${series.slug}`
  // docs/12 §2: a generated 1200×630 card, so a shared series link previews as the cover,
  // the title and the PALScans mark rather than a bare 2:3 cover cropped by the network.
  const card = await ogSeriesCard(series.slug)
  const ogKey = series.ogImageKey ?? series.coverKey
  const ogUrl = storageUrl(ogKey)
  const fallback = ogUrl
    ? ogUrl.startsWith('http')
      ? ogUrl
      : `${env.SITE_URL}${ogUrl}`
    : undefined
  const image = card ?? fallback
  const imageEntry = image
    ? {
        url: image,
        alt: fmt(messages.seriesDetail.coverAlt, { title: series.title }),
        ...(card ? { width: OG_WIDTH, height: OG_HEIGHT, type: 'image/png' } : {}),
      }
    : undefined
  return {
    title: { absolute: title },
    description: truncateWords(description, 300),
    alternates: { canonical },
    robots: series.noindex ? { index: false, follow: true } : undefined,
    openGraph: {
      type: 'website',
      siteName: env.SITE_NAME,
      title,
      description,
      url: canonical,
      ...(imageEntry ? { images: [imageEntry] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  }
}

/**
 * The series page. The direction comes from `settings.layouts.series` (Appearance →
 * Layouts) and is resolved through the registry in `lib/layouts/series.ts`; `?layout=`
 * previews another one. The data helpers stay split so the shell can move to PPR/ISR later.
 */
export default async function SeriesPage({ params, searchParams }: PageProps) {
  const [{ slug }, sp] = await Promise.all([params, searchParams])
  const view = await loadSeriesView(slug, sp)
  if (!view) notFound()
  const { layout, ...rest } = view
  const preview = typeof sp.layout === 'string' ? sp.layout : undefined
  const Layout = seriesLayout(layout, preview)
  return (
    <>
      {/* docs/02 "Views and ranking": the browser reports the view, this render never writes. */}
      <ViewBeacon seriesId={rest.series.id} />
      <Layout {...rest} />
    </>
  )
}
