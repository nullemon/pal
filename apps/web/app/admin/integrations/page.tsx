import { messages } from '@palscans/core/messages'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { configView } from '@/lib/config/store'
import { IntegrationsScreen } from './IntegrationsScreen'

/**
 * Admin → System → Integrations (docs/19). The credentials the site runs on — storage, mail,
 * sign-in, payments, bot protection, push and Discord — typed into the panel instead of into
 * a `.env` file on the server.
 *
 * `configView()` is the only thing this page reads, and it is the reason the page is
 * safe: plain values come through as they are, secrets are reduced to a mask, and each field
 * carries where its value came from.
 */
export const dynamic = 'force-dynamic'

export default async function IntegrationsPage() {
  await withPermission('settings.write', { returnTo: '/admin/integrations' })
  const view = await configView()
  const m = messages.admin.integrations
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <IntegrationsScreen initial={view} />
    </>
  )
}
