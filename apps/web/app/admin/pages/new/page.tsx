import { adminMessages } from '@palscans/core/messages/admin'
import { PageEditor } from '@/components/admin/content/PageEditor'
import { EMPTY_PAGE } from '@/components/admin/content/schemas'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'

export default async function NewAdminPagePage() {
  await withPermission('settings.write', { returnTo: '/admin/pages/new' })
  const m = adminMessages.adminContent.pages
  return (
    <>
      <PageHeader title={m.newPage} subtitle={m.notRenderedHint} />
      <PageEditor id={null} doc={EMPTY_PAGE} version={null} />
    </>
  )
}
