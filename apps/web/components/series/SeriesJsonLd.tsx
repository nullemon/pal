import { messages } from '@palscans/core/messages'
import type { SeriesDetail } from '@palscans/db'

export interface SeriesJsonLdProps {
  series: SeriesDetail
  siteUrl: string
  siteName: string
  coverUrl: string | null
  latestChapterNumber: number | null
}

/**
 * docs/12 §4: `BreadcrumbList` + `ComicSeries` with `aggregateRating.ratingCount` = the real
 * rating count (never bookmarks), `alternateName[]`, `author`, `illustrator`, `genre[]`,
 * `numberOfEpisodes`, `datePublished`, `image`. One script per page, built from typed data.
 */
export function seriesJsonLd({
  series,
  siteUrl,
  siteName,
  coverUrl,
  latestChapterNumber,
}: SeriesJsonLdProps): object[] {
  const url = `${siteUrl}/series/${series.slug}`
  const authors = series.people
    .filter((p) => p.credit === 'author')
    .map((p) => ({ '@type': 'Person', name: p.name }))
  const artists = series.people
    .filter((p) => p.credit === 'artist')
    .map((p) => ({ '@type': 'Person', name: p.name }))
  const comic: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'ComicSeries',
    name: series.title,
    url,
    ...(series.titles.length ? { alternateName: series.titles.map((t) => t.title) } : {}),
    ...(series.synopsis ? { description: series.synopsis } : {}),
    ...(coverUrl
      ? { image: coverUrl.startsWith('http') ? coverUrl : `${siteUrl}${coverUrl}` }
      : {}),
    ...(authors.length ? { author: authors.length === 1 ? authors[0] : authors } : {}),
    ...(artists.length ? { illustrator: artists.length === 1 ? artists[0] : artists } : {}),
    ...(series.genres.length ? { genre: series.genres.map((g) => g.name) } : {}),
    numberOfEpisodes: series.chapterCount,
    ...(series.releasedYear ? { datePublished: String(series.releasedYear) } : {}),
    ...(series.publishedAt ? { dateCreated: series.publishedAt.toISOString() } : {}),
    ...(latestChapterNumber !== null
      ? { workExample: { '@type': 'ComicIssue', issueNumber: latestChapterNumber } }
      : {}),
    publisher: { '@type': 'Organization', name: siteName, url: siteUrl },
  }
  if (series.ratingCount > 0) {
    comic.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Number(Number(series.ratingAvg ?? 0).toFixed(1)),
      bestRating: 10,
      worstRating: 1,
      ratingCount: series.ratingCount,
    }
  }
  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: siteName, item: siteUrl },
      {
        '@type': 'ListItem',
        position: 2,
        name: messages.discovery.seriesCrumb,
        item: `${siteUrl}/browse`,
      },
      { '@type': 'ListItem', position: 3, name: series.title, item: url },
    ],
  }
  return [breadcrumbs, comic]
}

/** `<` is escaped so a title can never close the script element. */
export const serializeJsonLd = (data: unknown): string =>
  JSON.stringify(data).replace(/</g, '\\u003c')

export function SeriesJsonLd(props: SeriesJsonLdProps) {
  const payload = serializeJsonLd(seriesJsonLd(props))
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD built from typed data, `<` escaped
      dangerouslySetInnerHTML={{ __html: payload }}
    />
  )
}
