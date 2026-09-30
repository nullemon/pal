import { can } from '@palscans/core'
import { adminMessages } from '@palscans/core/messages/admin'
import { duplicateCandidates, listPeople } from '@/components/admin/server/people'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { PeopleScreen } from './PeopleScreen'

/**
 * Admin → Content → People.
 *
 * `series.read` to open, `series.update` to rename, `series.delete` to merge — the same
 * ladder the genre screen uses, for the same reason: a rename is a correction, a merge
 * destroys a row that cannot be recovered.
 */
export default async function PeoplePage() {
  const user = await withPermission('series.read', { returnTo: '/admin/people' })
  const [people, duplicates] = await Promise.all([listPeople(null), duplicateCandidates()])
  const m = adminMessages.peopleAdmin
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <PeopleScreen
        initial={people}
        duplicates={duplicates}
        canRename={can(user, 'series.update')}
        canMerge={can(user, 'series.delete')}
      />
    </>
  )
}
