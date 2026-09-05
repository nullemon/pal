import { fmt, messages } from '@palscans/core/messages'
import { getDb, readingListById } from '@palscans/db'
import type { SeriesType } from '@palscans/ui'
import { Button } from '@palscans/ui'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { coverSrc } from '@/components/discovery/media'
import { siteUrl } from '@/components/discovery/metadata'
import { ListEditor, type ListEditorItem } from '@/components/me/ListEditor'
import { PageTitle } from '../../_components/Section'
import { requireAccount } from '../../_lib'

export const metadata: Metadata = { title: messages.me.lists.title }

const idSchema = z.coerce.number().int().positive()

/**
 * `/me/lists/[id]` — one list, owned. Loading is by id and then checked against the signed
 * in account: a list someone else owns 404s exactly like one that never existed.
 */
export default async function ListDetailPage({ params }: PageProps<'/me/lists/[id]'>) {
  const { id: raw } = await params
  const id = idSchema.safeParse(raw)
  if (!id.success) notFound()
  const user = await requireAccount(`/me/lists/${id.data}`)
  const db = await getDb()
  const list = await readingListById(db, id.data)
  if (!list || list.owner.id !== user.id) notFound()
  const m = messages.me.lists

  const items: ListEditorItem[] = list.items.map((item) => ({
    seriesId: item.seriesId,
    slug: item.slug,
    title: item.title,
    type: item.type as SeriesType | 'novel',
    cover: coverSrc(item.coverKey, item.coverColor),
    chapterCount: item.chapterCount,
  }))

  return (
    <>
      <PageTitle title={list.name}>
        <Button href="/me/lists" variant="outline" size="sm">
          {m.backToLists}
        </Button>
      </PageTitle>
      <p className="mb-5 text-[13px] text-fg-muted">
        {list.itemCount === 1 ? m.itemCountOne : fmt(m.itemCount, { n: list.itemCount })}
        {list.isPublic ? '' : ` · ${m.privateNotice}`}
      </p>
      <ListEditor
        list={{
          id: list.id,
          name: list.name,
          description: list.description,
          isPublic: list.isPublic,
          slug: list.slug,
        }}
        items={items}
        shareUrl={siteUrl(`/lists/${user.username ?? ''}/${list.slug}`)}
      />
    </>
  )
}
