import { fmt, messages } from '@palscans/core/messages'
import { getDb, listsForUser } from '@palscans/db'
import { Chip, EmptyState, RelativeTime } from '@palscans/ui'
import { Globe, Lock } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ListCreateForm } from '@/components/me/ListCreateForm'
import { PageTitle } from '../_components/Section'
import { requireAccount } from '../_lib'

export const metadata: Metadata = { title: messages.me.lists.title }

/**
 * `/me/lists` — the reader's own shelves (docs/13 "Custom reading lists", docs/17 §G).
 * Bookmarks keep the five fixed statuses; this is where a reader names their own.
 */
export default async function ListsPage() {
  const user = await requireAccount('/me/lists')
  const db = await getDb()
  const lists = await listsForUser(db, user.id)
  const m = messages.me.lists

  return (
    <>
      <PageTitle title={m.title}>
        <ListCreateForm />
      </PageTitle>
      <p className="mb-5 max-w-[65ch] text-[13px] text-fg-muted">{m.lead}</p>
      {lists.length === 0 ? (
        <EmptyState title={m.empty} description={m.emptyLead} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {lists.map((list) => (
            <li key={list.id}>
              <Link
                href={`/me/lists/${list.id}`}
                className="flex h-full flex-col rounded-lg border border-line bg-surface-1 p-4 transition-colors hover:border-brand"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-display text-[15px] font-extrabold text-fg">
                    {list.name}
                  </span>
                  <Chip variant="genre" size="sm" className="gap-1">
                    {list.isPublic ? (
                      <Globe size={11} aria-hidden="true" />
                    ) : (
                      <Lock size={11} aria-hidden="true" />
                    )}
                    {list.isPublic ? m.public : m.private}
                  </Chip>
                </div>
                {list.description ? (
                  <p className="mt-1 line-clamp-2 text-[13px] text-fg-muted">{list.description}</p>
                ) : null}
                <p className="mt-3 text-[12px] text-fg-subtle">
                  {list.itemCount === 1 ? m.itemCountOne : fmt(m.itemCount, { n: list.itemCount })}
                  {' · '}
                  <RelativeTime iso={list.updatedAt.toISOString()} />
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
