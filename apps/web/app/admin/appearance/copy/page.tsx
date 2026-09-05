import { adminMessages } from '@palscans/core/messages/admin'
import { CopyScreen } from '@/components/admin/client/CopyScreen'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { loadSiteCopy } from '@/lib/copy/settings'

/**
 * Appearance → Copy (docs/15 "Copy the operator owns" and "Formatting").
 *
 * `loadSiteCopy` rather than the cached read: an operator who has just saved must see their
 * own write, and the 60s data cache would show them the previous value for up to a minute
 * and make the screen look broken.
 *
 * Only the *overrides* reach the form. Everything else opens empty with the shipped string
 * as its placeholder, which is what makes "clear the field" and "reset to default" the same
 * gesture.
 */
export default async function CopyPage() {
  await withPermission('settings.write', { returnTo: '/admin/appearance/copy' })
  const { overrides, formatting } = await loadSiteCopy()
  const m = adminMessages.copyScreen
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <CopyScreen initialCopy={{ ...overrides }} initialFormatting={formatting} />
    </>
  )
}
