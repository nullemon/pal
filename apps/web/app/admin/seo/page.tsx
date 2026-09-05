import { adminMessages } from '@palscans/core/messages/admin'
import { getDb } from '@palscans/db'
import type { Metadata } from 'next'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { getEnv } from '@/lib/env'
import { indexNowLog, listRedirects, seriesOptions, sitemapBuildViews } from '@/lib/seo/admin-data'
import { loadSeoSettings } from '@/lib/seo/settings'
import { SeoAdmin } from './SeoAdmin'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: adminMessages.adminSeo.title,
  robots: { index: false, follow: false },
}

/**
 * Admin → System → SEO (docs/12 §8): identity, templates with a live preview, verification,
 * sitemap, feeds, indexing rules, redirects, robots.txt and the JSON-LD validator. Renders
 * inside P5's admin shell (app/admin/layout.tsx), which already gates on `admin.access`;
 * this page additionally requires `settings.write`.
 */
export default async function SeoAdminPage() {
  await withPermission('settings.write', { returnTo: '/admin/seo' })
  const db = await getDb()
  const [settings, builds, redirects, indexNow, series] = await Promise.all([
    loadSeoSettings(db),
    sitemapBuildViews(db),
    listRedirects(db),
    indexNowLog(db),
    seriesOptions(db),
  ])
  const origin = new URL(getEnv().SITE_URL).origin
  return (
    <>
      <PageHeader title={adminMessages.adminSeo.title} subtitle={adminMessages.adminSeo.subtitle} />
      <SeoAdmin
        initial={{
          settings,
          builds,
          indexNow,
          series,
          origin,
          redirects: redirects.map((r) => ({
            id: r.id,
            from: r.fromPath,
            to: r.toPath,
            status: r.status,
            hits: Number(r.hits),
            createdAt: r.createdAt.toISOString(),
          })),
        }}
      />
    </>
  )
}
