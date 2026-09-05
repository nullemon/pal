import { can } from '@palscans/core'
import { adminMessages } from '@palscans/core/messages/admin'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { SeriesEditor } from '@/components/admin/client/SeriesEditor'
import { idParam, parseSearch, type SearchParams } from '@/components/admin/server/params'
import { loadSeriesEditor } from '@/components/admin/server/series'
import { PageHeader } from '@/components/admin/ui'
import { coverSrc } from '@/components/discovery/media'
import { withPermission } from '@/lib/auth'
import { storageUrl } from '@/lib/storage'

const tabSchema = z.object({
  tab: z
    .enum([
      'details',
      'titles',
      'art',
      'people',
      'genres',
      'relations',
      'visibility',
      'seo',
      'chapters',
    ])
    .catch('details'),
})

export default async function SeriesEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<SearchParams>
}) {
  const id = idParam.safeParse((await params).id)
  if (!id.success) notFound()
  const user = await withPermission('series.read', { returnTo: `/admin/series/${id.data}` })
  const data = await loadSeriesEditor(id.data)
  if (!data) notFound()
  const { tab } = parseSearch(tabSchema, await searchParams)
  return (
    <>
      <PageHeader
        title={data.row.title}
        subtitle={`${adminMessages.admin.series.editor} · /${data.row.slug}`}
      />
      <SeriesEditor
        id={id.data}
        initialTab={tab}
        doc={data.doc}
        genres={data.genres}
        linked={data.linked}
        chapters={data.chapters.map((c) => ({
          ...c,
          earlyAccessUntil: c.earlyAccessUntil?.toISOString() ?? null,
          publishedAt: c.publishedAt?.toISOString() ?? null,
          deletedAt: c.deletedAt?.toISOString() ?? null,
        }))}
        coverUrl={coverSrc(data.row.coverKey, data.row.coverColor)}
        bannerUrl={data.row.bannerKey ? storageUrl(data.row.bannerKey) : null}
        perms={{
          update: can(user, 'series.update'),
          delete: can(user, 'series.delete'),
          publish: can(user, 'chapter.publish'),
          chapterUpdate: can(user, 'chapter.update'),
          chapterDelete: can(user, 'chapter.delete'),
          repair: can(user, 'chapter.repair'),
          create: can(user, 'chapter.create'),
        }}
        deleted={!!data.row.deletedAt}
      />
    </>
  )
}
