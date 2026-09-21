import { getDb } from '@palscans/db'
import { revalidateTag } from 'next/cache'
import { audit } from '@/components/admin/server/audit'
import { ok, parseJson, withPermission } from '@/lib/auth'
import { seoSaveSchema } from '@/lib/seo/admin'
import { indexNowLog, listRedirects, seriesOptions, sitemapBuildViews } from '@/lib/seo/admin-data'
import { loadSeoSettings, saveSeoSetting } from '@/lib/seo/settings'

/** GET: everything the SEO screen shows. PUT `{ key, value }`: save one settings row. */
export const GET = withPermission('settings.write', async () => {
  const db = await getDb()
  const [settings, builds, redirects, indexNow, series] = await Promise.all([
    loadSeoSettings(db),
    sitemapBuildViews(db),
    listRedirects(db),
    indexNowLog(db),
    seriesOptions(db),
  ])
  return ok({ settings, builds, redirects, indexNow, series })
})

export const PUT = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, seoSaveSchema)
  if (!parsed.ok) return parsed.response
  const { key, value } = parsed.data
  const db = await getDb()
  const before = (await loadSeoSettings(db))[key]
  await saveSeoSetting(db, key, value, user.id)
  await audit({
    actorId: user.id,
    action: 'seo.settings.update',
    targetType: 'seo_settings',
    before: { key, value: before },
    after: { key, value },
  })
  revalidateTag('seo', 'max')
  revalidateTag('settings', 'max')
  return ok({ key, value })
})
