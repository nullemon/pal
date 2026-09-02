import { fmt, messages } from '@palscans/core/messages'
import type { Metadata } from 'next'
import Link from 'next/link'
import { CATALOG_REVALIDATE, cachedGenres } from '@/components/discovery/cached'
import { pageMetadata } from '@/components/discovery/metadata'
import type { GenreSummary } from '@/components/discovery/types'

export const revalidate = 300

const KIND_TITLES: Record<string, string> = {
  genre: messages.browse.genres,
  theme: messages.genres.themes,
  format: messages.genres.formats,
}

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata(
    'home',
    {},
    {
      path: '/genres',
      override: {
        title: `${messages.genres.title} · ${messages.site.name}`,
        description: fmt(messages.discovery.genresIntro, { site: messages.site.name }),
      },
    },
  )
}

/** /genres — every genre, theme and format with its series count (ISR, {@link CATALOG_REVALIDATE}s). */
export default async function GenresPage() {
  const genres = await cachedGenres()
  const byKind = new Map<string, GenreSummary[]>()
  for (const g of genres) byKind.set(g.kind, [...(byKind.get(g.kind) ?? []), g])
  const kinds = ['genre', 'theme', 'format'].filter((k) => byKind.has(k))

  return (
    <div className="container-page flex flex-col gap-6 pt-5">
      <header className="flex flex-col gap-1">
        <h1 className="section-title text-[22px] leading-7">{messages.genres.title}</h1>
        <p className="text-[13px] text-fg-muted">
          {fmt(messages.discovery.genresIntro, { site: messages.site.name })}
        </p>
      </header>
      {kinds.map((kind) => (
        <section key={kind} aria-labelledby={`kind-${kind}`} className="flex flex-col gap-2">
          <h2 id={`kind-${kind}`} className="section-title text-[16px]">
            {KIND_TITLES[kind] ?? kind}
          </h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {(byKind.get(kind) ?? []).map((g) => (
              <li key={g.id}>
                <Link
                  href={g.href}
                  className="flex h-11 items-center justify-between gap-2 rounded-md border border-line bg-surface-1 px-3 text-[13px] font-bold text-fg transition-colors duration-[120ms] hover:border-fg-subtle hover:bg-surface-2"
                >
                  <span className="truncate">{g.name}</span>
                  <span className="shrink-0 text-[11px] font-semibold tabular-nums text-fg-subtle">
                    {fmt(messages.genres.count, { n: g.count })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
