import { adminMessages } from '@palscans/core/messages/admin'
import { BillingPanels } from '@/components/admin/premium/BillingPanels'
import { EntitlementPanels } from '@/components/admin/premium/EntitlementPanels'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { entitlementOverrides } from '@/lib/entitlements'

/**
 * `Admin → Business → Premium`. Two halves, one screen: the operator's entitlement
 * overrides (docs/17 §B, agent B) above, and Stripe billing (docs/17 §A, agent A) below.
 * Neither half knows about the other — `BillingPanels` loads its own data.
 */
export default async function AdminPremiumPage() {
  await withPermission('settings.write', { returnTo: '/admin/premium' })
  const overrides = await entitlementOverrides()
  const m = adminMessages.admin.premium
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <EntitlementPanels initial={overrides} />
      <BillingPanels />
    </>
  )
}
