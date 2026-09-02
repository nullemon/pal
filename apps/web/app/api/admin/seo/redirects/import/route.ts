import { getDb, redirects } from '@palscans/db'
import { revalidateTag } from 'next/cache'
import { audit } from '@/components/admin/server/audit'
import { ok, parseJson, withPermission } from '@/lib/auth'
import { parseRedirectsCsv, redirectsCsvSchema } from '@/lib/seo/admin'
import { listRedirects } from '@/lib/seo/admin-data'

/** CSV import for the legacy-site migration: `from,to[,status]` per line; existing rules are updated. */
export const POST = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, redirectsCsvSchema)
  if (!parsed.ok) return parsed.response
  const { rows, errors } = parseRedirectsCsv(parsed.data.csv)
  const db = await getDb()
  let imported = 0
  for (const r of rows) {
    await db
      .insert(redirects)
      .values({ fromPath: r.from, toPath: r.to, status: r.status, createdBy: user.id })
      .onConflictDoUpdate({
        target: redirects.fromPath,
        set: { toPath: r.to, status: r.status, createdBy: user.id },
      })
    imported += 1
  }
  await audit({
    actorId: user.id,
    action: 'seo.redirect.import',
    targetType: 'redirects',
    after: { imported, errors: errors.length },
    request,
  })
  revalidateTag('redirects', 'max')
  return ok({ imported, errors, redirects: await listRedirects(db) })
})
