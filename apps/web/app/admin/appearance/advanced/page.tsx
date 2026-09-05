import { adminMessages } from '@palscans/core/messages/admin'
import { AdvancedScreen } from '@/components/admin/client/AdvancedScreen'
import { loadAdvanced } from '@/components/admin/server/appearance'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'

/**
 * Admin → Appearance → Advanced (docs/15 "Advanced").
 *
 * `appearance.advanced`, which only the `admin` role can hold (`ADMIN_ONLY_PERMISSIONS` in
 * `@palscans/core`) and which `Admin → Access → Roles` refuses to hand to anybody else. Any
 * other signed-in staff member gets the panel's usual 404 rather than a "forbidden", so the
 * screen does not even advertise itself. The admin layout has already turned away an `admin`
 * without TOTP, and the write route checks that again.
 *
 * The published row, not the cached read: an operator who has just saved has to see their
 * own write, and the 300s appearance cache would otherwise show them the previous stylesheet
 * and make the page look broken.
 */
export default async function AdvancedPage() {
  await withPermission('appearance.advanced', { returnTo: '/admin/appearance/advanced' })
  const advanced = await loadAdvanced()
  const m = adminMessages.advancedScreen
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <AdvancedScreen initial={advanced} />
    </>
  )
}
