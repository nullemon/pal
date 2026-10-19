import { DEFAULT_SEO_TEMPLATES, DEFAULT_SEPARATOR, renderSeo } from '@palscans/core'
import { DEFAULT_CHAPTER_LANGUAGE } from '@palscans/core/languages'
import { chapterLocale, localeChapterHint, localeChapterLabel } from '@palscans/core/locale'
import { messages } from '@palscans/core/messages'
import { getDb, getSeoSetting } from '@palscans/db'
import type { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import { z } from 'zod'
import { getEnv } from '@/lib/env'
import { OG_HEIGHT, OG_WIDTH } from '@/lib/seo/og-card'
import { chapterOgUrl, ogSeriesBySlug } from '@/lib/seo/og-data'
import { chapterHref, formatChapterNumber, seriesHref } from '../params'
import type { ChapterBundle, ReaderSeriesRow } from './data'

const templateSchema = z.object({ title: z.string(), description: z.string() }).partial()
const templatesSchema = z.object({ chapter: templateSchema.catch({}) }).partial()
const indexingSchema = z.object({
  site: z.boolean().catch(true),
  chapters: z.boolean().catch(true),
})
const identitySchema = z.object({
  site_name: z.string().min(1).catch('PALScans'),
  // Parsed here too: the chapter title template uses `{sep}`, and an unparsed separator
  // renders as nothing rather than failing loudly.
  separator: z.enum(['-', '·', '—', '|']).catch(DEFAULT_SEPARATOR),
})

interface ChapterSeo {
  siteName: string
  /** The operator's separator. Parsed here because the chapter template uses `{sep}`. */
  separator: string
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
      separator: id.success ? id.data.separator : DEFAULT_SEPARATOR,
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
  /** The chapter's language. Decides every string on the page and its canonical URL. */
  language?: string
  /**
   * The other languages *this chapter number* exists in, for `hreflang`.
   *
   * This number, not the series': a series with a German run that stopped at 40 must not
   * tell Google that chapter 90 has a German version. An `hreflang` pointing at a 404 is
   * worse than none — it is a promise the site does not keep, and the pair is dropped.
   */
  languages?: readonly string[]
}

const nextPrevHint = (b: ChapterBundle, language: string): string =>
  localeChapterHint(
    language,
    b.prev ? formatChapterNumber(b.prev.number) : null,
    b.next ? formatChapterNumber(b.next.number) : null,
  )

export async function chapterMetadata(input: ChapterMetaInput): Promise<Metadata> {
  const env = getEnv()
  const seo = await cachedChapterSeo()
  const { series, bundle } = input
  const language = input.language ?? DEFAULT_CHAPTER_LANGUAGE
  const locale = chapterLocale(language)
  const number = formatChapterNumber(bundle.chapter.number)
  /**
   * The operator's own template wins in the site's language, and only there.
   *
   * They wrote it in English, for English pages. Rendering it on a German chapter would put
   * an English title on a German URL, which is the exact thing this is here to stop — so a
   * translated chapter falls back to its own language's default. Per-language overrides in
   * the panel are the obvious next step; this is the behaviour that needs no new settings.
   */
  const template =
    language === DEFAULT_CHAPTER_LANGUAGE
      ? { ...DEFAULT_SEO_TEMPLATES.chapter, ...seo.template }
      : locale.seo
  const rendered = renderSeo(
    'chapter',
    {
      site: seo.siteName,
      sep: seo.separator,
      title: series.title,
      type: messages.series.type[series.type],
      chapter: number,
      next_prev_hint: nextPrevHint(bundle, language),
    },
    { chapter: template },
  )
  const path = chapterHref(series.slug, bundle.chapter.number, language)
  const url = new URL(path, env.SITE_URL).toString()
  const card = await chapterCardImage(series.slug, number)
  // The generated card is the preview; the first page (or the cover) is only the fallback
  // for the rare series the card endpoint cannot build one for.
  const fallback = input.firstPageUrl ?? input.coverUrl
  const absImage = card
    ? card.url
    : fallback
      ? new URL(fallback, env.SITE_URL).toString()
      : undefined
  const image = absImage
    ? {
        url: absImage,
        alt: rendered.title,
        ...(card ? { width: OG_WIDTH, height: OG_HEIGHT, type: 'image/png' } : {}),
      }
    : undefined
  const noindex = !seo.indexChapters || series.noindex
  /**
   * `hreflang` for every language this chapter number is actually published in.
   *
   * Each translation is its own URL with its own title and its own canonical pointing at
   * itself — the canonical above carries `?lang=`, which is the fix that matters: pointing
   * a German page at the English URL tells Google the German one is a duplicate and should
   * be dropped from the index, which is precisely what we do not want.
   *
   * `x-default` goes to the English URL, which is also the parameter-free one.
   */
  const alternateLanguages = Object.fromEntries(
    (input.languages ?? [])
      .filter((code) => code !== language)
      .map((code) => [
        code,
        new URL(chapterHref(series.slug, bundle.chapter.number, code), env.SITE_URL).toString(),
      ]),
  )
  const hreflang =
    Object.keys(alternateLanguages).length > 0
      ? {
          ...alternateLanguages,
          'x-default': new URL(
            chapterHref(series.slug, bundle.chapter.number),
            env.SITE_URL,
          ).toString(),
        }
      : undefined
  return {
    title: { absolute: rendered.title },
    description: rendered.description,
    alternates: { canonical: url, ...(hreflang ? { languages: hreflang } : {}) },
    robots: noindex ? { index: false, follow: true } : undefined,
    openGraph: {
      type: 'article',
      siteName: seo.siteName,
      title: rendered.title,
      description: rendered.description,
      locale: locale.ogLocale,
      url,
      ...(image ? { images: [image] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: rendered.title,
      description: rendered.description,
      ...(absImage ? { images: [absImage] } : {}),
    },
  }
}

/**
 * The chapter's share card as an absolute URL (docs/12 §2: `og:image` at 1200×630). Null
 * when the series row is not readable from here — metadata must never fail over an image,
 * so the caller falls back to the first page.
 */
const chapterCardImage = async (slug: string, chapter: string): Promise<{ url: string } | null> => {
  try {
    const row = await ogSeriesBySlug(slug)
    if (!row) return null
    return { url: new URL(chapterOgUrl(row, chapter), getEnv().SITE_URL).toString() }
  } catch {
    return null
  }
}

/** docs/12 §4: `BreadcrumbList` + `ComicIssue` (issueNumber, name, isPartOf, datePublished, image = first page). */
export function chapterJsonLd(input: ChapterMetaInput): Record<string, unknown> {
  const env = getEnv()
  const { series, bundle } = input
  const number = formatChapterNumber(bundle.chapter.number)
  const abs = (p: string) => new URL(p, env.SITE_URL).toString()
  const language = input.language ?? DEFAULT_CHAPTER_LANGUAGE
  const chapterUrl = abs(chapterHref(series.slug, bundle.chapter.number, language))
  const label = localeChapterLabel(language, number)
  const name = bundle.chapter.title ? `${label}: ${bundle.chapter.title}` : label
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
        // Which translation this page is. The German chapter and the English one are the
        // same issue at different URLs, and this is what says so in the structured data.
        inLanguage: language,
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
