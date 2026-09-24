import { adminMessages } from '@palscans/core/messages/admin'
import { getDb, users } from '@palscans/db'
import { and, asc, inArray, isNull } from 'drizzle-orm'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { RemoteScreen } from './RemoteScreen'

/**
 * Admin → System → Remote (last item in System).
 *
 * `settings.write`: issuing a key hands out an account's permissions to something that is not
 * a person, which belongs with the screens that configure the site rather than the ones that
 * edit content.
 */
export default async function RemotePage() {
  await withPermission('settings.write', { returnTo: '/admin/system/remote' })
  const db = await getDb()
  // Only accounts that can actually do something through the API are offered. Pointing a key
  // at a reader would issue one that 403s on every call.
  const eligible = await db
    .select({ id: users.id, username: users.username, email: users.email, role: users.role })
    .from(users)
    .where(and(inArray(users.role, ['uploader', 'moderator', 'admin']), isNull(users.deletedAt)))
    .orderBy(asc(users.id))
    .limit(100)
  const m = adminMessages.remote
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <RemoteScreen users={eligible} />
    </>
  )
}
