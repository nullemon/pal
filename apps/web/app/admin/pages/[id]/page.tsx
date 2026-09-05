import { messages } from '@palscans/core/messages'
import { notFound } from 'next/navigation'
import { PageEditor } from '@/components/admin/content/PageEditor'
import { loadPageEditor } from '@/components/admin/content/queries'
import { idParam } from '@/components/admin/server/params'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'

export default async function AdminPageEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const id = idParam.safeParse((await params).id)
  if (!id.success) notFound()
  await withPermission('settings.write', { returnTo: `/admin/pages/${id.data}` })
  const data = await loadPageEditor(id.data)
  if (!data) notFound()
  const m = messages.adminContent.pages
  return (
    <>
      <PageHeader title={data.doc.title} subtitle={`${m.editor} · /${data.doc.slug}`} />
      <PageEditor id={data.id} doc={data.doc} version={data.version} />
    </>
  )
}
