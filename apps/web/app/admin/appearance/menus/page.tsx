import { adminMessages } from '@palscans/core/messages/admin'
import { MenusScreen } from '@/components/admin/client/MenusScreen'
import { workflowState } from '@/components/admin/server/appearance'
import { PageHeader } from '@/components/admin/ui'
import { loadScopeState } from '@/lib/appearance/versions'
import { withPermission } from '@/lib/auth'

/**
 * Appearance → Header, footer, menus (docs/15).
 *
 * The form opens on the **draft** when one is saved and on what is **live** otherwise —
 * never on an empty form, which is what would wipe the footer on an unconfigured site's
 * first save. `loadScopeState` reads uncached for the same reason it always did: this
 * screen's job is showing what is stored, and `revalidateTag` leaves one stale render behind
 * a publish.
 */
export default async function MenusPage() {
  await withPermission('settings.write', { returnTo: '/admin/appearance/menus' })
  const state = await loadScopeState('menus')
  const m = adminMessages.menus
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <MenusScreen initial={state.draft?.doc ?? state.live} workflow={workflowState(state)} />
    </>
  )
}
