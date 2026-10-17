import { normaliseLanguage } from '@palscans/core/languages'
import { fmt, messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { can } from '@palscans/core/permissions'
import { getDb, series } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import {
  MAX_CHAPTER_BYTES,
  type UploadIntent,
  uploadIntentSchema,
} from '@/components/admin/schemas'
import { audit } from '@/components/admin/server/audit'
import { resolveChapterSlot } from '@/components/admin/server/chapters'
import { fail, notFound, ok, parseJson, withPermission } from '@/lib/auth'
import { presignUpload } from '@/lib/storage'

const ext: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
}

/**
 * Thrown to abandon a batch: it carries the response the caller must get, and unwinding
 * through it is what rolls the transaction back. A plain `return` out of the callback would
 * commit the rows created so far, which is the whole bug this exists to prevent.
 */
class IntentAbort extends Error {
  constructor(readonly response: Response) {
    super('upload intent aborted')
  }
}

/** A chapter row resolved for this batch, with the manifest that still needs signing. */
interface ResolvedChapter {
  chapterId: number
  number: number
  reused: boolean
  /** True when this intent is rebuilding a chapter that already had pages. */
  replaced: boolean
  files: UploadIntent['chapters'][number]['files']
}

/**
 * POST /api/upload/intent — the manifest (docs/03 step 3–4): validates per-file and
 * per-chapter caps, creates or reuses the chapter rows, and answers one presigned PUT per
 * file. Keys are `uploads/<series>/<chapter>/<idx>-<sha12>.<ext>` (originals; the worker
 * writes the content-addressed variants under `pages/`).
 *
 * The whole batch resolves in one transaction. A bulk ZIP drop submits dozens of chapters in
 * a single intent and any of them can be refused — too large, already has pages, no repair
 * permission, already processing — so without a transaction a refusal on chapter 40 left
 * thirty-nine `draft` rows with `page_count = 0` behind: invisible on the site, but cluttering
 * the chapter list and the calendar backlog, and *holding the numbers hostage* — the unique
 * index on (series_id, number) covers soft-deleted rows, so a later real upload of chapter 12
 * could not have the number back. Either the whole manifest is accepted or nothing is written.
 *
 * Signing happens after the commit: presigning is pure computation against the storage
 * driver, and a batch of 400 files has no business holding a database connection open.
 */
export const POST = withPermission('chapter.create', async (request, _ctx, user) => {
  const parsed = await parseJson(request, uploadIntentSchema)
  if (!parsed.ok) return parsed.response
  const { seriesId } = parsed.data
  // Normalised rather than trusted: this arrives from a dropdown, an API client or a hand
  // -written request, and an unrecognised tag becomes English instead of failing the upload.
  const language = normaliseLanguage(parsed.data.language)
  const db = await getDb()
  const [s] = await db
    .select({ id: series.id })
    .from(series)
    .where(and(eq(series.id, seriesId), isNull(series.deletedAt)))
    .limit(1)
  if (!s) return notFound()

  /**
   * Two entries for the same number in one batch, refused before anything is written.
   *
   * `resolveChapterSlot` cannot catch this, and the way it failed to was quiet. The first
   * entry inserted the row; the second ran its lookup inside the *same* transaction, found
   * that brand-new row, saw `page_count = 0` and reused it as an empty slot — which is
   * exactly the right behaviour for a draft left by an earlier upload, and exactly the wrong
   * one for a row this batch created a millisecond ago. Both entries came back pointing at
   * one chapter id, so two sets of files were signed into one chapter's folder and the
   * second commit replaced the first's pages. Two chapters in, one chapter out, no error.
   *
   * Compared on the number as the database stores it (`numeric(10,3)`), because that is what
   * the unique index compares: 7 and 7.0 are one chapter, and a batch containing both is a
   * mistake however it was typed.
   */
  const seen = new Map<string, number>()
  for (const ch of parsed.data.chapters) {
    const key = ch.number.toFixed(3)
    const first = seen.get(key)
    if (first !== undefined)
      return fail(
        400,
        'duplicate_number',
        fmt(adminMessages.bulkImport.issues.duplicateNumberServer, { n: String(ch.number) }),
      )
    seen.set(key, ch.number)
  }

  let resolved: ResolvedChapter[]
  try {
    resolved = await db.transaction(async (tx) => {
      const rows: ResolvedChapter[] = []
      for (const ch of parsed.data.chapters) {
        const total = ch.files.reduce((n, f) => n + f.bytes, 0)
        if (total > MAX_CHAPTER_BYTES)
          throw new IntentAbort(fail(413, 'chapter_too_large', messages.errors.validation))
        const slot = await resolveChapterSlot(tx, {
          seriesId,
          number: ch.number,
          language,
          title: ch.title ?? null,
          replace: ch.replace,
          canRepair: can(user, 'chapter.repair'),
          userId: user.id,
        })
        if (!slot.ok) {
          if (slot.code === 'chapter_exists')
            throw new IntentAbort(
              fail(
                409,
                'chapter_exists',
                fmt(adminMessages.bulkImport.conflict.title, {
                  n: String(ch.number),
                  pages: slot.pages,
                }),
              ),
            )
          if (slot.code === 'forbidden')
            throw new IntentAbort(fail(403, 'forbidden', messages.errors.forbidden))
          if (slot.code === 'already_processing')
            throw new IntentAbort(fail(409, 'already_processing'))
          throw new IntentAbort(fail(500, 'insert_failed'))
        }
        const { chapterId, reused, replaced } = slot
        rows.push({ chapterId, number: ch.number, reused, replaced, files: ch.files })
      }
      return rows
    })
  } catch (error) {
    if (error instanceof IntentAbort) return error.response
    throw error
  }

  const out = await Promise.all(
    resolved.map(async (ch) => ({
      chapterId: ch.chapterId,
      number: ch.number,
      reused: ch.reused,
      replaced: ch.replaced,
      files: await Promise.all(
        ch.files.map(async (f, idx) => {
          const key = `uploads/${seriesId}/${ch.chapterId}/${String(idx).padStart(4, '0')}-${f.sha256.slice(0, 12)}.${ext[f.type]}`
          const signed = await presignUpload(key, f.type, user.id, f.bytes)
          return {
            name: f.name,
            key,
            url: signed.url,
            method: signed.method,
            headers: signed.headers,
          }
        }),
      ),
    })),
  )
  await audit({
    actorId: user.id,
    action: 'chapter.upload_intent',
    targetType: 'series',
    targetId: seriesId,
    after: {
      chapters: out.map((c) => ({
        chapterId: c.chapterId,
        number: c.number,
        files: c.files.length,
        reused: c.reused,
        replaced: c.replaced,
      })),
    },
  })
  return ok({ chapters: out, expiresAt: new Date(Date.now() + 900_000).toISOString() })
})
