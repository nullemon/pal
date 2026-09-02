import { fmt, messages } from '@palscans/core/messages'
import { EmptyState } from '@palscans/ui'
import { Megaphone } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { JsonLd } from '@/lib/seo/JsonLd'
import { breadcrumbJsonLd, itemListJsonLd } from '@/lib/seo/jsonld'
import { buildMetadata } from '@/lib/seo/metadata'
import { absoluteUrl, announcementPath } from '@/lib/seo/urls'
import { listAnnouncements } from './data'

export const revalidate = 300

export function generateMetadata(): Promise<Metadata> {
  return buildMetadata('announcements', {
    path: '/announcements',
    override: { title: messages.announcements.title, description: messages.announcements.intro },
    feed: '/announcements/feed',
  })
}

const m = messages.announcements

/** /announcements — the list; each entry links to its page (Article JSON-LD lives there). */
export default async function AnnouncementsPage() {
  const rows = await listAnnouncements()
  return (
    <div className="container-page pt-6 pb-10">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: messages.seo.breadcrumbHome, url: absoluteUrl('/') },
            { name: m.title, url: absoluteUrl('/announcements') },
          ]),
          itemListJsonLd(
            m.title,
            rows.map((r) => ({ name: r.title, url: absoluteUrl(announcementPath(r.slug)) })),
          ),
        ]}
      />
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-5">
        <div>
          <h1 className="section-title text-[26px] leading-8">{m.title}</h1>
          <p className="mt-1 text-[14px] text-fg-muted">{m.intro}</p>
        </div>
        <a
          href="/announcements/feed"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface-1 px-3 text-[13px] font-semibold text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          {messages.seo.feed.rss}
        </a>
      </header>
      {rows.length === 0 ? (
        <EmptyState title={m.empty} icon={<Megaphone size={28} />} />
      ) : (
        <ol className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => {
            const published = r.publishedAt ?? r.updatedAt
            return (
              <li key={r.id}>
                <article className="flex h-full flex-col gap-2 rounded-lg border border-line bg-surface-1 p-5 transition-colors hover:border-brand-dim">
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
                    <time dateTime={published} className="tabular-nums">
                      {published.slice(0, 10)}
                    </time>
                    {r.author ? (
                      <span>· {fmt(m.by, { name: r.authorDisplay ?? r.author })}</span>
                    ) : null}
                    {r.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-sm bg-brand-wash px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-brand-hover"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                  <h2 className="font-display text-[20px] font-extrabold leading-6 tracking-[-0.02em] text-fg">
                    <Link href={announcementPath(r.slug)} className="hover:text-brand-hover">
                      {r.title}
                    </Link>
                  </h2>
                  {r.excerpt ? (
                    <p className="text-[14px] leading-6 text-fg-muted">{r.excerpt}</p>
                  ) : null}
                  <Link
                    href={announcementPath(r.slug)}
                    className="mt-auto pt-1 text-[13px] font-semibold text-brand-hover hover:underline"
                  >
                    {m.readMore} →
                  </Link>
                </article>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
