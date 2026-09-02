import { dryRun, unparsedChaptersCsv } from '@palscans/core/import'
import { readImportDoc, resolveSource } from '@/app/admin/import/service'
import { withPermission } from '@/lib/auth'

/**
 * GET /api/admin/import/unparsed — the review CSV docs/09 asks for, regenerated from a fresh
 * dry run so it carries every row rather than the capped list held on the settings document.
 */
export const GET = withPermission('settings.write', async () => {
  const doc = await readImportDoc()
  const { source } = resolveSource(doc.config)
  const report = await dryRun(source, { maxUnparsed: 100_000 })
  await source.close?.()
  return new Response(unparsedChaptersCsv(report.unparsedChapters), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="unparsed-chapters.csv"',
      'cache-control': 'no-store',
    },
  })
})
