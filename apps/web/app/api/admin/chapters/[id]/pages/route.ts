import { chapters, getDb } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/components/admin/server/audit'
import { purgeCatalog } from '@/components/admin/server/cache'
import { applyPageEdits, editorPages, savePageEdits } from '@/components/admin/server/chapter-pages'
import { idParam } from '@/components/admin/server/params'
import { fail, notFound, ok, parseJson, withPermission } from '@/lib/auth'

/**
 * The pages of one chapter: read them, reorder them, delete them.
 *
 * `chapter.repair` rather than `chapter.update` — the permission has existed since the roles
 * were defined, described as "replace pages on an existing chapter, nothing else", and this
 * is the first thing behind it. It is held by uploader as well as moderator, which is the
 * point: fixing a page order is the job of whoever uploaded it, not an escalation.
 */

const editSchema = z
  .object({
    order: z.array(z.string().max(32)).max(2000).optional(),
    deleted: z.array(z.string().max(32)).max(2000).optional(),
  })
  .refine((b) => b.order?.length || b.deleted?.length, {
    message: 'nothing to apply',
  })

/** GET /api/admin/chapters/:id/pages — the grid's data. */
export const GET = withPermission<{ id: string }>('chapter.repair', async (_request, ctx) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const db = await getDb()
  const [row] = await db
    .select({
      processing: chapters.processing,
      seriesId: chapters.seriesId,
      number: chapters.number,
    })
    .from(chapters)
    .where(eq(chapters.id, id.data))
    .limit(1)
  if (!row) return notFound()
  // A chapter with no processing document has never been through the worker; there is
  // nothing to edit, and an empty grid says so more clearly than an error.
  if (!row.processing) return ok({ pages: [], sources: 0, editable: false })
  return ok({
    pages: await editorPages(row.processing),
    sources: row.processing.sources.length,
    editable: true,
  })
})

/**
 * PATCH /api/admin/chapters/:id/pages — apply a reorder and/or deletion.
 *
 * The response carries the resulting pages rather than an acknowledgement. Reordering is
 * source-level while the grid is page-level, so dragging one segment of a split upload moves
 * the whole upload; returning the real arrangement lets the grid re-sync to what happened
 * instead of displaying an order the database does not have.
 */
export const PATCH = withPermission<{ id: string }>(
  'chapter.repair',
  async (request, ctx, user) => {
    const id = idParam.safeParse((await ctx.params).id)
    if (!id.success) return notFound()
    const parsed = await parseJson(request, editSchema)
    if (!parsed.ok) return parsed.response

    const db = await getDb()
    const [row] = await db
      .select({ processing: chapters.processing, seriesId: chapters.seriesId })
      .from(chapters)
      .where(eq(chapters.id, id.data))
      .limit(1)
    if (!row) return notFound()
    if (!row.processing) return fail(409, 'validation')

    const before = row.processing
    let saved: Awaited<ReturnType<typeof savePageEdits>>
    try {
      // Applied once here purely to surface a bad request as a 400 rather than a 500 from
      // inside the transaction — the core functions throw on an order that is not a
      // permutation, which is a client mistake, not a server fault.
      applyPageEdits(before, parsed.data)
      saved = await savePageEdits(id.data, parsed.data, db)
    } catch {
      return fail(400, 'validation')
    }
    if (!saved) return notFound()

    await audit({
      actorId: user.id,
      action: 'chapter.pages',
      targetType: 'chapter',
      targetId: id.data,
      before: { pages: before.sources.length, dropped: before.dropped?.length ?? 0 },
      after: { pages: saved.doc.sources.length, dropped: saved.doc.dropped?.length ?? 0 },
    })
    await purgeCatalog()

    return ok({ pages: await editorPages(saved.doc), sources: saved.doc.sources.length })
  },
)
