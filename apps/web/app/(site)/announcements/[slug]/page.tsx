import { fmt, messages } from '@palscans/core/messages'
import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { RichText, richTextToPlain } from '@/components/discovery/RichText'
import { JsonLd } from '@/lib/seo/JsonLd'
import { articleJsonLd, breadcrumbJsonLd } from '@/lib/seo/jsonld'
import { buildMetadata } from '@/lib/seo/metadata'
import { cachedSeoSettings } from '@/lib/seo/settings'
import { absoluteUrl, announcementPath, storagePublicUrl } from '@/lib/seo/urls'
import { announcementBySlug } from '../data'

export const revalidate = 300

const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,199}$/i)

async function load(raw: string) {
  const parsed = slugSchema.safeParse(raw)
  return parsed.success ? announcementBySlug(parsed.data.toLowerCase()) : null
}

export async function generateMetadata({
  params,
}: PageProps<'/announcements/[slug]'>): Promise<Metadata> {
  const { slug } = await params
  const a = await load(slug)
  if (!a) return { title: messages.errors.notFound, robots: { index: false } }
  const excerpt = a.excerpt ?? richTextToPlain(a.body)
  return buildMetadata('announcement', {
    path: announcementPath(a.slug),
    vars: { title: a.title, excerpt },
    image: storagePublicUrl(a.coverKey),
    ogType: 'article',
    feed: '/announcements/feed',
  })
}

const m = messages.announcements

/** /announcements/<slug> — the post with `Article` JSON-LD (docs/12 §4). */
export default async function AnnouncementPage({ params }: PageProps<'/announcements/[slug]'>) {
  const { slug } = await params
  const [a, settings] = await Promise.all([load(slug), cachedSeoSettings()])
  if (!a) notFound()
  const site = settings.identity.site_name
  const url = absoluteUrl(announcementPath(a.slug))
  const published = a.publishedAt ?? a.updatedAt
  const image =
    storagePublicUrl(a.coverKey) ?? storagePublicUrl(settings.identity.default_og_image_key)
  const authorName = a.authorDisplay ?? a.author ?? site
  return (
    <div className="container-page pt-6 pb-10">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: messages.seo.breadcrumbHome, url: absoluteUrl('/') },
            { name: m.title, url: absoluteUrl('/announcements') },
            { name: a.title, url },
          ]),
          articleJsonLd({
            url,
            headline: a.title,
            description: a.excerpt ?? richTextToPlain(a.body).slice(0, 200),
            datePublished: published,
            dateModified: a.updatedAt,
            author: { name: authorName },
            publisher: {
              name: site,
              url: absoluteUrl('/'),
              logo: storagePublicUrl(settings.identity.logo_key),
            },
            image,
          }),
        ]}
      />
      <article className="mx-auto max-w-[72ch]">
        <Link
          href="/announcements"
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-fg-muted hover:text-fg"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          {m.back}
        </Link>
        <header className="mt-4 mb-6 border-b border-line pb-5">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-muted">
            <span>{m.published}</span>
            <time dateTime={published} className="tabular-nums text-fg">
              {published.slice(0, 10)}
            </time>
            <span>· {fmt(m.by, { name: authorName })}</span>
            {a.tags.map((t) => (
              <span
                key={t}
                className="rounded-sm bg-brand-wash px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-brand-hover"
              >
                {t}
              </span>
            ))}
          </div>
          <h1 className="mt-2 font-display text-[30px] font-extrabold leading-[1.1] tracking-[-0.02em] text-fg md:text-[38px]">
            {a.title}
          </h1>
        </header>
        <RichText doc={a.body} className="text-[16px] text-fg" />
      </article>
    </div>
  )
}
