import { fmt, messages } from '@palscans/core/messages'
import { EmptyState } from '@palscans/ui'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { slugSchema } from '@/components/discovery/filters'
import { pageMetadata } from '@/components/discovery/metadata'
import { groupDetail, withLatest } from '@/components/discovery/queries'
import { SeriesGrid } from '@/components/discovery/SeriesGrid'

/**
 * /groups/[slug] — everything a scanlation group has work on here.
 *
 * Crediting the group is the convention this work is shared under and some groups make it a
 * condition of hosting; a page that collects their titles and links back to them is the
 * other half of that bargain, and the natural place for the credit on a series page to point.
 *
 * Cached rather than dynamic: nothing on it is per-reader, and a group's list of titles moves
 * when a chapter is credited, not when somebody visits.
 */
export const revalidate = 300

const load = async (slugParam: string) => {
  const parsed = slugSchema.safeParse(slugParam)
  if (!parsed.success) return null
  return groupDetail(parsed.data)
}

export async function generateMetadata({ params }: PageProps<'/groups/[slug]'>): Promise<Metadata> {
  const { slug } = await params
  const group = await load(slug)
  if (!group) return { title: messages.errors.notFound, robots: { index: false } }
  /*
   * `override` carries the whole title and description rather than leaning on a template:
   * there is no `group` page type in the SEO templates, and borrowing the genre one would
   * render "Genre Manhwa & Manga" for a scanlation group.
   */
  return pageMetadata(
    'genre',
    { genre: group.name, count: group.series.length },
    {
      path: group.href,
      override: {
        title: fmt(messages.groups.seoTitle, { name: group.name }),
        description: group.description?.trim()
          ? group.description
          : fmt(messages.groups.seoDescription, {
              name: group.name,
              titles: group.series.length,
            }),
      },
    },
  )
}

export default async function GroupPage({ params }: PageProps<'/groups/[slug]'>) {
  const { slug } = await params
  const group = await load(slug)
  if (!group) notFound()
  const items = await withLatest(group.series)
  const links = Object.entries(group.links).slice(0, 6)

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-fg-muted">
          {messages.groups.scanlationGroup}
        </p>
        <h1 className="text-2xl font-bold leading-tight">{group.name}</h1>
        {group.description ? (
          <p className="max-w-[720px] text-[15px] leading-[24px] text-fg-muted">
            {group.description}
          </p>
        ) : null}
        {links.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {links.map(([label, url]) => (
              <li key={label}>
                {/*
                  `noopener` and `nofollow`: these are operator-entered links to third-party
                  sites, which is exactly the shape a spam link takes.
                */}
                <a
                  className="inline-flex h-7 items-center rounded-full border border-line bg-surface-1 px-[11px] text-[13px] font-medium transition-colors hover:border-brand"
                  href={url}
                  rel="noreferrer noopener nofollow"
                  target="_blank"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      {items.length === 0 ? (
        <EmptyState title={messages.groups.empty} />
      ) : (
        <SeriesGrid items={items} priorityCount={6} />
      )}
    </div>
  )
}
