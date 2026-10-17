import { fmt, messages } from '@palscans/core/messages'
import { EmptyState } from '@palscans/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { pageMetadata } from '@/components/discovery/metadata'
import { groupIndex } from '@/components/discovery/queries'

/** /groups — every scanlation group with published work here. */
export const revalidate = 300

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata(
    'genre',
    { genre: messages.groups.indexTitle, count: 0 },
    {
      path: '/groups',
      override: {
        title: messages.groups.indexTitle,
        description: messages.groups.indexSubtitle,
      },
    },
  )
}

export default async function GroupsPage() {
  const groups = await groupIndex()
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold leading-tight">{messages.groups.indexTitle}</h1>
        <p className="text-[15px] text-fg-muted">{messages.groups.indexSubtitle}</p>
      </header>
      {groups.length === 0 ? (
        <EmptyState title={messages.groups.indexEmpty} />
      ) : (
        <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <li key={g.slug}>
              <Link
                className="flex h-full flex-col gap-1 rounded-lg border border-line bg-surface-1 p-3.5 transition-colors hover:border-brand"
                href={g.href}
              >
                <span className="font-semibold">{g.name}</span>
                <span className="text-[12.5px] text-fg-muted">
                  {fmt(messages.groups.counts, { titles: g.titles, chapters: g.chapters })}
                </span>
                {g.description ? (
                  <span className="line-clamp-2 text-[12.5px] text-fg-subtle">{g.description}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
