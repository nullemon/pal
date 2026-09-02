import { fmt, messages } from '@palscans/core/messages'
import type { ReactNode } from 'react'
import { RichText } from '@/components/discovery/RichText'
import { JsonLd } from './JsonLd'
import { breadcrumbJsonLd } from './jsonld'
import type { LegalPage } from './legal'
import { absoluteUrl } from './urls'

/**
 * The shell every legal page shares (docs/13): breadcrumb, H1, "Last updated · version",
 * the rich-text body, then whatever the page adds (the DMCA agent card + form, the contact
 * form). Static server markup.
 */
export function LegalArticle({
  page,
  path,
  siteName,
  aside,
  children,
}: {
  page: LegalPage
  path: string
  siteName: string
  aside?: ReactNode
  children?: ReactNode
}) {
  const updated = new Date(page.updatedAt).toISOString()
  const [before = '', after = ''] = messages.legal.lastUpdated.split('{date}')
  return (
    <div className="container-page pt-6 pb-10">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: messages.seo.breadcrumbHome, url: absoluteUrl('/') },
          { name: page.title, url: absoluteUrl(path) },
        ])}
      />
      <nav aria-label={messages.discovery.breadcrumbs} className="mb-4 text-[13px] text-fg-muted">
        <ol className="flex items-center gap-1.5">
          <li>
            <a href="/" className="hover:text-fg">
              {siteName}
            </a>
          </li>
          <li aria-hidden="true" className="text-fg-subtle">
            /
          </li>
          <li className="text-fg">{page.title}</li>
        </ol>
      </nav>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <article className="min-w-0 max-w-[72ch]">
          <header className="mb-5 border-b border-line pb-5">
            <h1 className="font-display text-[30px] font-extrabold uppercase leading-[1.1] tracking-[-0.02em] text-fg md:text-[36px]">
              {page.title}
            </h1>
            <p className="mt-2 text-[13px] text-fg-muted">
              {before}
              <time dateTime={updated} className="tabular-nums">
                {updated.slice(0, 10)}
              </time>
              {fmt(after, { version: page.version })}
            </p>
          </header>
          <RichText doc={page.body} className="text-[15.5px]" />
          {children}
        </article>
        {aside ? <aside className="flex flex-col gap-4 lg:pt-14">{aside}</aside> : null}
      </div>
    </div>
  )
}
