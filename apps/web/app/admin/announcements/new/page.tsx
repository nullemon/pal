import { messages } from '@palscans/core/messages'
import { AnnouncementEditor } from '@/components/admin/content/AnnouncementEditor'
import { EMPTY_ANNOUNCEMENT } from '@/components/admin/content/schemas'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'

export default async function NewAnnouncementPage() {
  await withPermission('announcement.write', { returnTo: '/admin/announcements/new' })
  const m = messages.adminContent.announcements
  return (
    <>
      <PageHeader title={m.newAnnouncement} />
      <AnnouncementEditor id={null} doc={EMPTY_ANNOUNCEMENT} canDelete={false} />
    </>
  )
}
