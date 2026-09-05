import { z } from 'zod'
import { formatChapterNumber } from '@/components/reader/params'
import { ogChapterExists, ogSeriesBySlug } from '@/lib/seo/og-data'
import { ogCardResponse, ogNotFound } from '@/lib/seo/og-route'

/**
 * GET /api/og/chapter/<slug>/<n>?v=<fingerprint> — the share card for one chapter
 * (docs/12 §2). `<n>` is the bare number, `12.5` included; the reader's own URL uses
 * `chapter-12.5`, but this is an image endpoint, not a page, so it takes the number.
 *
 * Only published chapters get a card. A draft or a deleted chapter is a 404 — a preview is
 * a public artefact and would announce a chapter that is not out yet.
 */

export const dynamic = 'force-dynamic'

const slugSchema = z.string().min(1).max(200)
const chapterSchema = z
  .string()
  .regex(/^\d{1,7}(?:\.\d{1,3})?$/)
  .transform(Number.parseFloat)
  .pipe(z.number().finite().nonnegative())

export async function GET(request: Request, ctx: RouteContext<'/api/og/chapter/[slug]/[chapter]'>) {
  const { slug, chapter } = await ctx.params
  const parsedSlug = slugSchema.safeParse(slug)
  const parsedChapter = chapterSchema.safeParse(chapter)
  if (!parsedSlug.success || !parsedChapter.success) return ogNotFound()

  const row = await ogSeriesBySlug(parsedSlug.data)
  if (!row) return ogNotFound()
  if (!(await ogChapterExists(row.id, parsedChapter.data))) return ogNotFound()

  return ogCardResponse({
    request,
    row,
    chapter: formatChapterNumber(parsedChapter.data),
    version: new URL(request.url).searchParams.get('v'),
  })
}
