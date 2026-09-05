import { adminMessages } from '@palscans/core/messages/admin'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { ImportScreen } from './ImportScreen'
import { latestRunView } from './run-service'
import { maskImportDoc, readImportDoc } from './service'

/**
 * Admin → System → Import (docs/17 §E, mapping in docs/09). Source configuration, the
 * read-only discovery report, the dry run with its review CSV, and the import run.
 */
export default async function ImportPage() {
  await withPermission('settings.write', { returnTo: '/admin/import' })
  const [doc, run] = await Promise.all([readImportDoc().then(maskImportDoc), latestRunView()])
  const m = adminMessages.admin.import
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <ImportScreen initial={doc} run={run} />
    </>
  )
}
