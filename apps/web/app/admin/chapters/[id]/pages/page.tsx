import { adminMessages } from '@palscans/core/messages/admin'
import { chapters, getDb, series } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { PageEditor } from '@/components/admin/client/PageEditor'
import { editorPages } from '@/components/admin/server/chapter-pages'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'

/**
 * Admin → Chapters → a chapter → Pages.
 *
 * `chapter.repair`, which uploaders hold: putting a page back in the right order is the job
 * of whoever uploaded it, not something that should need a moderator.
 */
export default async function ChapterPagesPage({
  params,
}: PageProps<'/admin/chapters/[id]/pages'>) {
  const { id } = await params
  const chapterId = Number(id)
  if (!Number.isInteger(chapterId) || chapterId <= 0) notFound()
  await withPermission('chapter.repair', { returnTo: `/admin/chapters/${chapterId}/pages` })

  const db = await getDb()
  const [row] = await db
    .select({
      processing: chapters.processing,
      number: chapters.number,
      title: chapters.title,
      seriesTitle: series.title,
    })
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(eq(chapters.id, chapterId))
    .limit(1)
  if (!row) notFound()

  const m = adminMessages.pageEditor
  const pages = row.processing ? await editorPages(row.processing) : []
  return (
    <>
      <PageHeader
        title={`${row.seriesTitle} · ${row.number}${row.title ? ` — ${row.title}` : ''}`}
        subtitle={m.subtitle}
      />
      <PageEditor chapterId={chapterId} initial={pages} editable={!!row.processing} />
    </>
  )
}
