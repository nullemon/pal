import { adminMessages } from '@palscans/core/messages/admin'
import { CopyScreen } from '@/components/admin/client/CopyScreen'
import { workflowState } from '@/components/admin/server/appearance'
import { PageHeader } from '@/components/admin/ui'
import { loadScopeState } from '@/lib/appearance/versions'
import { withPermission } from '@/lib/auth'

/**
 * Appearance → Copy (docs/15 "Copy the operator owns" and "Formatting").
 *
 * Opens on the draft when there is one and on what is live otherwise, read uncached: an
 * operator who has just saved must see their own write, and the 60s data cache would show
 * them the previous value for up to a minute and make the screen look broken.
 *
 * Only the *overrides* reach the form. Everything else opens empty with the shipped string
 * as its placeholder, which is what makes "clear the field" and "reset to default" the same
 * gesture.
 */
export default async function CopyPage() {
  await withPermission('settings.write', { returnTo: '/admin/appearance/copy' })
  const state = await loadScopeState('copy')
  const current = state.draft?.doc ?? state.live
  const m = adminMessages.copyScreen
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <CopyScreen
        initialCopy={{ ...current.copy }}
        initialFormatting={current.formatting}
        workflow={workflowState(state)}
      />
    </>
  )
}
