import { getEnv } from '@palscans/core/env'
import { GalleryError, resolveManifest } from '@palscans/core/gallery'
import { normaliseLanguage } from '@palscans/core/languages'
import { chapters, getDb } from '@palscans/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { manifestPreviewSchema } from '@/components/admin/schemas'
import { fail, ok, parseJson, withPermission } from '@/lib/auth'

/**
 * POST /api/admin/chapters/import/manifest/preview — what is in this manifest, and what of
 * it do we already have?
 *
 * Writes nothing. A hundred-chapter file is exactly the situation where an operator must see
 * the list before committing: which numbers are new, which already exist and would be
 * skipped, which entries the parser could not read, and which group it picked when a chapter
 * offered several. Importing first and explaining afterwards would mean a hundred chapters
 * to undo by hand.
 *
 * `seriesId` is optional because the operator may still be choosing one; when it is given,
 * every number is checked against that series so the conflicts are real rather than
 * hypothetical.
 */
export const POST = withPermission('chapter.create', async (request) => {
  const parsed = await parseJson(request, manifestPreviewSchema)
  if (!parsed.ok) return parsed.response
  const { url, group, seriesId, language } = parsed.data
  return preview(url, group ?? null, seriesId ?? null, language ?? null)
})

const preview = async (
  url: string,
  group: string | null,
  seriesId: number | null,
  language: string | null,
) => {
  try {
    const { url: raw, manifest } = await resolveManifest(url, {
      token: getEnv().IMGCHEST_TOKEN,
      group,
    })
    let existing = new Set<number>()
    if (seriesId) {
      const db = await getDb()
      const rows = await db
        .select({ number: chapters.number })
        .from(chapters)
        .where(
          and(
            eq(chapters.seriesId, seriesId),
            eq(chapters.language, normaliseLanguage(language)),
            isNull(chapters.deletedAt),
            inArray(
              chapters.number,
              manifest.chapters.map((c) => c.number),
            ),
          ),
        )
      existing = new Set(rows.map((r) => Number(r.number)))
    }
    return ok({
      url: raw,
      title: manifest.title,
      description: manifest.description,
      author: manifest.author,
      artist: manifest.artist,
      cover: manifest.cover,
      /** Every group name the file mentions, so the operator can pick a different one. */
      groups: [...new Set(manifest.chapters.map((c) => c.group).filter((g): g is string => !!g))],
      chapters: manifest.chapters.map((c) => ({
        key: c.key,
        number: c.number,
        title: c.title,
        volume: c.volume,
        group: c.group,
        provider: c.source.kind === 'gallery' ? c.source.provider : 'direct',
        pages: c.source.kind === 'direct' ? c.source.links.length : null,
        exists: existing.has(c.number),
      })),
      skipped: manifest.skipped,
    })
  } catch (error) {
    if (error instanceof GalleryError)
      return fail(error.code === 'not_found' ? 404 : 400, error.code, error.message)
    throw error
  }
}
