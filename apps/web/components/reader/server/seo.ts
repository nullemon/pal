import { DEFAULT_SEO_TEMPLATES, renderSeo } from '@palscans/core'
import { fmt, messages } from '@palscans/core/messages'
import { getDb, getSeoSetting } from '@palscans/db'
import type { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import { z } from 'zod'
import { getEnv } from '@/lib/env'
import { chapterHref, formatChapterNumber, seriesHref } from '../params'
import type { ChapterBundle, ReaderSeriesRow } from './data'

const templateSchema = z.object({ title: z.string(), description: z.string() }).partial()
const templatesSchema = z.object({ chapter: templateSchema.catch({}) }).partial()
const indexingSchema = z.object({
  site: z.boolean().catch(true),
  chapters: z.boolean().catch(true),
})
const identitySchema = z.object({ site_name: z.string().min(1).catch('PALScans') })

interface ChapterSeo {
  siteName: string
  template: { title?: string; description?: string }
  indexChapters: boolean
}

/** The docs/12 chapter template, indexing toggle and site name; admin rows override. */
export const cachedChapterSeo = unstable_cache(
  async (): Promise<ChapterSeo> => {
    const db = await getDb()
    const [templates, indexing, identity] = await Promise.all([
      getSeoSetting<unknown>(db, 'templates', null),
      getSeoSetting<unknown>(db, 'indexing', null),
      getSeoSetting<unknown>(db, 'identity', null),
    ])
    const t = templatesSchema.safeParse(templates ?? {})
    const i = indexingSchema.safeParse(indexing ?? {})
    const id = identitySchema.safeParse(identity ?? {})
    const env = getEnv()
    return {
      siteName: id.success ? id.data.site_name : env.SITE_NAME,
      template: t.success ? (t.data.chapter ?? {}) : {},
      indexChapters: i.success ? i.data.site && i.data.chapters : true,
    }
  },
  ['seo_settings', 'chapter'],
  { revalidate: 300, tags: ['settings'] },
)

export interface ChapterMetaInput {
  series: ReaderSeriesRow
  bundle: ChapterBundle
  /** First page URL, only when the viewer may read the chapter (never a locked page). */
  firstPageUrl: string | null
  coverUrl: string | null
}

const nextPrevHint = (b: ChapterBundle): string => {
  const parts: string[] = []
  if (b.prev) parts.push(`Previous: Chapter ${formatChapterNumber(b.prev.number)}.`)
  if (b.next) parts.push(`Next: Chapter ${formatChapterNumber(b.next.number)}.`)
  return parts.join(' ')
}

export async function chapterMetadata(input: ChapterMetaInput): Promise<Metadata> {
  const env = getEnv()
  const seo = await cachedChapterSeo()
  const { series, bundle } = input
  const number = formatChapterNumber(bundle.chapter.number)
  const rendered = renderSeo(
    'chapter',
    {
      site: seo.siteName,
      title: series.title,
      type: messages.series.type[series.type],
      chapter: number,
      next_prev_hint: nextPrevHint(bundle),
    },
    { chapter: { ...DEFAULT_SEO_TEMPLATES.chapter, ...seo.template } },
  )
  const path = chapterHref(series.slug, bundle.chapter.number)
  const url = new URL(path, env.SITE_URL).toString()
  const image = input.firstPageUrl ?? input.coverUrl
  const absImage = image ? new URL(image, env.SITE_URL).toString() : undefined
  const noindex = !seo.indexChapters || series.noindex
  return {
    title: { absolute: rendered.title },
    description: rendered.description,
    alternates: { canonical: url },
    robots: noindex ? { index: false, follow: true } : undefined,
    openGraph: {
      type: 'article',
      siteName: seo.siteName,
      title: rendered.title,
      description: rendered.description,
      url,
      ...(absImage ? { images: [{ url: absImage, alt: rendered.title }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: rendered.title,
      description: rendered.description,
      ...(absImage ? { images: [absImage] } : {}),
    },
  }
}

/** docs/12 §4: `BreadcrumbList` + `ComicIssue` (issueNumber, name, isPartOf, datePublished, image = first page). */
export function chapterJsonLd(input: ChapterMetaInput): Record<string, unknown> {
  const env = getEnv()
  const { series, bundle } = input
  const number = formatChapterNumber(bundle.chapter.number)
  const abs = (p: string) => new URL(p, env.SITE_URL).toString()
  const chapterUrl = abs(chapterHref(series.slug, bundle.chapter.number))
  const name = bundle.chapter.title
    ? fmt(messages.readerUi.chapterWithTitle, { n: number, title: bundle.chapter.title })
    : fmt(messages.readerUi.chapterTitle, { n: number })
  const image = input.firstPageUrl ?? input.coverUrl
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: messages.readerUi.breadcrumbHome,
            item: abs('/'),
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: series.title,
            item: abs(seriesHref(series.slug)),
          },
          { '@type': 'ListItem', position: 3, name, item: chapterUrl },
        ],
      },
      {
        '@type': 'ComicIssue',
        '@id': chapterUrl,
        url: chapterUrl,
        issueNumber: number,
        name: `${series.title} ${name}`,
        isPartOf: {
          '@type': 'ComicSeries',
          name: series.title,
          url: abs(seriesHref(series.slug)),
        },
        ...(bundle.chapter.publishedAt ? { datePublished: bundle.chapter.publishedAt } : {}),
        ...(image ? { image: abs(image) } : {}),
      },
    ],
  }
}
