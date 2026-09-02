import { importSettingSchema, mergeDsn } from '@palscans/core/import'
import { maskImportDoc, readImportDoc, writeImportDoc } from '@/app/admin/import/service'
import { audit } from '@/components/admin/server/audit'
import { purgeSettings } from '@/components/admin/server/cache'
import { ok, parseJson, withPermission } from '@/lib/auth'

/**
 * PUT /api/admin/import — save the legacy importer's source configuration (docs/17 §E).
 * The DSN password is kept server-side: if the operator sends the masked value back, the
 * stored password survives, and the response is masked again on the way out.
 */
export const PUT = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, importSettingSchema)
  if (!parsed.ok) return parsed.response

  const doc = await readImportDoc()
  const config = { ...parsed.data, dsn: mergeDsn(parsed.data.dsn, doc.config.dsn) }
  const next = { ...doc, config }
  await writeImportDoc(next, user.id)
  purgeSettings()

  await audit({
    actorId: user.id,
    action: 'settings.import',
    targetType: 'settings',
    before: { config: { ...doc.config, dsn: doc.config.dsn === '' ? '' : '(set)' } },
    after: { config: { ...config, dsn: config.dsn === '' ? '' : '(set)' } },
    request,
  })
  return ok(maskImportDoc(next))
})
