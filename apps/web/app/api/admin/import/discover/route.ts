import { discover } from '@palscans/core/import'
import {
  maskImportDoc,
  readImportDoc,
  resolveSource,
  writeImportDoc,
} from '@/app/admin/import/service'
import { audit } from '@/components/admin/server/audit'
import { purgeSettings } from '@/components/admin/server/cache'
import { ok, withPermission } from '@/lib/auth'

/**
 * POST /api/admin/import/discover — read the legacy source and report what it holds
 * (docs/17 §E). Writes nothing to the legacy site and nothing to the catalogue; the report
 * itself is stored on the settings row so the screen reloads into it.
 */
export const POST = withPermission('settings.write', async (_request, _ctx, user) => {
  const doc = await readImportDoc()
  const { source, fallback } = resolveSource(doc.config)
  const report = await discover(source)
  await source.close?.()

  const next = { ...doc, discovery: { ...report, ranAt: new Date().toISOString() } }
  await writeImportDoc(next, user.id)
  purgeSettings()
  await audit({
    actorId: user.id,
    action: 'import.discover',
    targetType: 'settings',
    after: { source: report.source, counts: report.counts, chapterStorage: report.chapterStorage },
  })
  return ok({ ...maskImportDoc(next), fallback })
})
