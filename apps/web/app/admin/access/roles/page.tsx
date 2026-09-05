import { adminMessages } from '@palscans/core/messages/admin'
import { PageHeader, Panel, PanelHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { readPermissionOverrides } from '@/lib/auth/roles'
import { RolesMatrix } from './RolesMatrix'

/**
 * `Admin → Access → Roles`.
 *
 * Gated on `settings.write`, the same as the rest of Access — and `settings.write` is one of
 * the two permissions this screen will not let anyone revoke from `admin`, because it is
 * this page's own gate. The other is `admin.access`, which opens the panel at all.
 *
 * What is stored is only the cells that differ from the bundles compiled into
 * `@palscans/core`; everything else resolves from the code at read time. So a deployment
 * that never opens this page behaves exactly as it does today, and a permission added in a
 * later release arrives with the default that release gave it rather than being denied to
 * every role because it was absent from a frozen matrix.
 */
export default async function RolesPage() {
  await withPermission('settings.write', { returnTo: '/admin/access/roles' })
  const overrides = await readPermissionOverrides()
  const m = adminMessages.roles
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <RolesMatrix initial={overrides} />
      <Panel>
        <PanelHeader title={m.howTitle} />
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[13px] leading-[18px] text-fg-muted">
          <li>{m.howDefaults}</li>
          <li>{m.howCache}</li>
          <li>{m.howAudit}</li>
          <li>{m.howSessions}</li>
        </ul>
      </Panel>
    </>
  )
}
