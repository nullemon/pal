import { can, FEATURES, isStaffRole, ROLES } from '@palscans/core'
import { messages } from '@palscans/core/messages'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { NewUserForm } from './NewUserForm'

/** Admin → Users → new (docs/17 §C): create an account by hand. */
export default async function NewUserPage() {
  const actor = await withPermission('user.update', { returnTo: '/admin/users/new' })
  const m = messages.admin.users
  // A moderator may create readers only; staff roles stay with admins (core `canActOn`).
  const roles: string[] = can(actor, 'user.role')
    ? ROLES.filter((r) => actor.role === 'admin' || !isStaffRole(r))
    : ['user']
  return (
    <>
      <PageHeader title={m.newUserTitle} subtitle={m.newUserSubtitle} />
      <NewUserForm
        roles={roles}
        features={[...FEATURES]}
        canGrant={can(actor, 'entitlement.grant')}
      />
    </>
  )
}
