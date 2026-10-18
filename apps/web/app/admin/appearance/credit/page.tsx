import { adminMessages } from '@palscans/core/messages/admin'
import { creditSettings } from '@/components/admin/server/credit'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { CreditScreen } from './CreditScreen'

/**
 * Appearance → Credit page (docs/03): the card inserted as every new chapter's second page.
 *
 * `settings.write`, like the watermark and the theme — it decides how every chapter looks,
 * which is not a decision to make while adding one.
 */
export default async function CreditPage() {
  await withPermission('settings.write', { returnTo: '/admin/appearance/credit' })
  const settings = await creditSettings()
  return (
    <>
      <PageHeader
        title={adminMessages.creditPage.title}
        subtitle={adminMessages.creditPage.subtitle}
      />
      <CreditScreen initial={settings} />
    </>
  )
}
