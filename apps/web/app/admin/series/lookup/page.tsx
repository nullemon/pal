import { adminMessages } from '@palscans/core/messages/admin'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { LookupScreen } from './LookupScreen'

/**
 * Admin → Content → Add from AniList (docs/04 Content group).
 *
 * `series.create`, not `series.update`: this screen makes rows. An uploader who may edit an
 * existing series has no business filling the catalogue from a third-party source.
 */
export default async function SeriesLookupPage() {
  await withPermission('series.create', { returnTo: '/admin/series/lookup' })
  const m = adminMessages.seriesLookup
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <LookupScreen />
    </>
  )
}
