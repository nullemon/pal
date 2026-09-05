import { adminMessages } from '@palscans/core/messages/admin'
import { UploadQueue } from '@/components/admin/client/UploadQueue'
import { loadQueue } from '@/components/admin/server/queue'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'

export default async function UploadQueuePage() {
  await withPermission('chapter.read', { returnTo: '/admin/upload/queue' })
  const initial = await loadQueue()
  const m = adminMessages.admin.upload.queue
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <UploadQueue initial={initial} />
    </>
  )
}
