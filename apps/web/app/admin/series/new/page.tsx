import { messages } from '@palscans/core/messages'
import { NewSeriesForm } from '@/components/admin/client/NewSeriesForm'
import { PageHeader, Panel } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'

export default async function NewSeriesPage() {
  await withPermission('series.create', { returnTo: '/admin/series/new' })
  return (
    <>
      <PageHeader title={messages.admin.series.newSeries} />
      <Panel className="max-w-xl">
        <NewSeriesForm />
      </Panel>
    </>
  )
}
