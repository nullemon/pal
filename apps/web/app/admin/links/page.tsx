import { adminMessages } from '@palscans/core/messages/admin'
import { getDb } from '@palscans/db'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { getEnv } from '@/lib/env'
import { listRedirects } from '@/lib/seo/admin-data'
import { LinksScreen } from './LinksScreen'

/**
 * Admin → Links (docs/13): short paths that send people somewhere else.
 *
 * `settings.write` like the SEO screen it shares a table with — a link in the site's own
 * namespace pointing wherever it likes is not something an uploader should be able to add.
 */
export default async function LinksPage() {
  await withPermission('settings.write', { returnTo: '/admin/links' })
  const db = await getDb()
  const rows = await listRedirects(db)
  return (
    <>
      <PageHeader title={adminMessages.links.title} subtitle={adminMessages.links.subtitle} />
      <LinksScreen
        initial={rows.map((r) => ({
          id: r.id,
          fromPath: r.fromPath,
          toPath: r.toPath,
          status: r.status,
          hits: Number(r.hits),
        }))}
        origin={getEnv().SITE_URL.replace(/\/$/, '')}
      />
    </>
  )
}
