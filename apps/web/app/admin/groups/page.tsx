import { can } from '@palscans/core'
import { adminMessages } from '@palscans/core/messages/admin'
import { listGroups } from '@/components/admin/server/groups'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { GroupsScreen } from './GroupsScreen'

/**
 * Admin → Content → Groups.
 *
 * `series.read` to open, so an uploader can see who is credited and pick a group when
 * crediting chapters; the create and edit controls need `series.update`, which they do not
 * hold. Inventing a group in the catalogue and crediting one that exists are different acts.
 */
export default async function GroupsPage() {
  const user = await withPermission('series.read', { returnTo: '/admin/groups' })
  const m = adminMessages.groupsAdmin
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <GroupsScreen initial={await listGroups()} canEdit={can(user, 'series.update')} />
    </>
  )
}
