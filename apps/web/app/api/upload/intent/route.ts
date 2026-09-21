import { fmt, messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { chapters, getDb, series } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import {
  MAX_CHAPTER_BYTES,
  type UploadIntent,
  uploadIntentSchema,
} from '@/components/admin/schemas'
import { audit } from '@/components/admin/server/audit'
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
  const db = await getDb()
  const [s] = await db
    .select({ id: series.id })
    .from(series)
    .where(and(eq(series.id, seriesId), isNull(series.deletedAt)))
    .limit(1)
  if (!s) return notFound()
  const { can } = await import('@palscans/core')

  let resolved: ResolvedChapter[]
  try {
    resolved = await db.transaction(async (tx) => {
      const rows: ResolvedChapter[] = []
      for (const ch of parsed.data.chapters) {
        const total = ch.files.reduce((n, f) => n + f.bytes, 0)
        if (total > MAX_CHAPTER_BYTES)
          throw new IntentAbort(fail(413, 'chapter_too_large', messages.errors.validation))
        const [existing] = await tx
          .select({ id: chapters.id, state: chapters.state, pageCount: chapters.pageCount })
          .from(chapters)
          .where(
            and(
              eq(chapters.seriesId, seriesId),
              eq(chapters.number, ch.number),
              isNull(chapters.deletedAt),
            ),
          )
          .limit(1)
        let chapterId: number
        let reused = false
        let replaced = false
        if (existing) {
          // A chapter that already has pages is only ever replaced on purpose: the bulk
          // preview makes the operator choose skip or replace, and `replace` is that answer.
          // Without it the intent refuses rather than quietly rebuilding a published chapter.
          if (existing.pageCount > 0 && ch.replace !== true)
            throw new IntentAbort(
              fail(
                409,
                'chapter_exists',
                fmt(adminMessages.bulkImport.conflict.title, {
                  n: String(ch.number),
                  pages: existing.pageCount,
                }),
              ),
            )
          // replacing pages on an existing chapter is a repair (docs/04 "Repair")
          if (existing.pageCount > 0 && !can(user, 'chapter.repair'))
            throw new IntentAbort(fail(403, 'forbidden', messages.errors.forbidden))
          if (existing.state === 'processing')
            throw new IntentAbort(fail(409, 'already_processing'))
          chapterId = existing.id
          reused = true
          replaced = existing.pageCount > 0
        } else {
          const [created] = await tx
            .insert(chapters)
            .values({
              seriesId,
              number: ch.number,
              title: ch.title ?? null,
              state: 'draft',
              uploadedBy: user.id,
            })
            .returning({ id: chapters.id })
          if (!created) throw new IntentAbort(fail(500, 'insert_failed'))
          chapterId = created.id
        }
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
