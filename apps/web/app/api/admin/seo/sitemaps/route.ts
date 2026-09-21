import { getDb } from '@palscans/db'
import { audit } from '@/components/admin/server/audit'
import { ok, withPermission } from '@/lib/auth'
import { indexNowLog, sitemapBuildViews } from '@/lib/seo/admin-data'
import { buildSitemaps } from '@/lib/seo/sitemaps'
import { getStorage } from '@/lib/storage'

/** GET: the build log. POST: "Regenerate now" — a full build, synchronously. */
export const GET = withPermission('settings.write', async () => {
  const db = await getDb()
  return ok({ builds: await sitemapBuildViews(db), indexNow: await indexNowLog(db) })
})

export const POST = withPermission('settings.write', async (_request, _ctx, user) => {
  const db = await getDb()
  const result = await buildSitemaps({ kind: 'full', db, storage: await getStorage() })
  await audit({
    actorId: user.id,
    action: 'seo.sitemap.rebuild',
    targetType: 'sitemap_builds',
    targetId: result.id,
    after: { urlCount: result.urlCount, files: result.files, error: result.error },
  })
  return ok({
    result: {
      ...result,
      startedAt: result.startedAt.toISOString(),
      finishedAt: result.finishedAt.toISOString(),
    },
    builds: await sitemapBuildViews(db),
    indexNow: await indexNowLog(db),
  })
})
