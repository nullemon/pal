import { dryRun } from '@palscans/core/import'
import {
  maskImportDoc,
  readImportDoc,
  resolveSource,
  storeableDryRun,
  writeImportDoc,
} from '@/app/admin/import/service'
import { audit } from '@/components/admin/server/audit'
import { purgeSettings } from '@/components/admin/server/cache'
import { ok, withPermission } from '@/lib/auth'

/**
 * POST /api/admin/import/dry-run — map everything and count what an import would write,
 * including the list of chapter names the parser refused (docs/09). Writes nothing.
 */
export const POST = withPermission('settings.write', async (_request, _ctx, user) => {
  const doc = await readImportDoc()
  const { source, fallback } = resolveSource(doc.config)
  const report = await dryRun(source)
  await source.close?.()

  const ranAt = new Date().toISOString()
  const next = {
    ...doc,
    discovery: { ...report.discovery, ranAt },
    dryRun: storeableDryRun(report, ranAt),
  }
  await writeImportDoc(next, user.id)
  purgeSettings()
  await audit({
    actorId: user.id,
    action: 'import.dryRun',
    targetType: 'settings',
    after: { source: report.discovery.source, totals: report.totals },
  })
  return ok({ ...maskImportDoc(next), fallback })
})
