import { messages } from '@palscans/core/messages'
import { UploadQueue } from '@/components/admin/client/UploadQueue'
import { loadQueue } from '@/components/admin/server/queue'
import { PageHeader } from '@/components/admin/ui'

export default async function UploadQueuePage() {
  const initial = await loadQueue()
  const m = messages.admin.upload.queue
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <UploadQueue initial={initial} />
    </>
  )
}
