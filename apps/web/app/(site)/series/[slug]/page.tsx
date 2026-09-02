import { renderSeo, truncateWords } from '@palscans/core'
import { fmt, messages } from '@palscans/core/messages'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { storageUrl } from '@/lib/comments/media'
import { getEnv } from '@/lib/env'
import { seriesLayout } from '@/lib/layouts'
import { chapterRows, getSeries } from './data'
import { loadSeriesView } from './view'

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
  const ogKey = series.ogImageKey ?? series.coverKey
  const ogUrl = storageUrl(ogKey)
  const image = ogUrl ? (ogUrl.startsWith('http') ? ogUrl : `${env.SITE_URL}${ogUrl}`) : undefined
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
      ...(image
        ? {
            images: [
              { url: image, alt: fmt(messages.seriesDetail.coverAlt, { title: series.title }) },
            ],
          }
        : {}),
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
 * Layouts) and is resolved through the registry in `lib/layouts.ts`; `?layout=` previews
 * another one. The data helpers stay split so the shell can move to PPR/ISR later.
 */
export default async function SeriesPage({ params, searchParams }: PageProps) {
  const [{ slug }, sp] = await Promise.all([params, searchParams])
  const view = await loadSeriesView(slug, sp)
  if (!view) notFound()
  const { layout, ...rest } = view
  const preview = typeof sp.layout === 'string' ? sp.layout : undefined
  const Layout = seriesLayout(layout, preview)
  return <Layout {...rest} />
}
