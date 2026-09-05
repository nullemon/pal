import { messages } from '@palscans/core/messages'
import { notFound } from 'next/navigation'
import { AnnouncementEditor } from '@/components/admin/content/AnnouncementEditor'
import { loadAnnouncementEditor } from '@/components/admin/content/queries'
import { idParam } from '@/components/admin/server/params'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'

export default async function AnnouncementEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const id = idParam.safeParse((await params).id)
  if (!id.success) notFound()
  await withPermission('announcement.write', { returnTo: `/admin/announcements/${id.data}` })
  const data = await loadAnnouncementEditor(id.data)
  if (!data) notFound()
  const m = messages.adminContent.announcements
  return (
    <>
      <PageHeader
        title={data.doc.title || m.untitled}
        subtitle={`${m.editor} · /announcements/${data.doc.slug}`}
      />
      <AnnouncementEditor id={data.id} doc={data.doc} canDelete />
    </>
  )
}
