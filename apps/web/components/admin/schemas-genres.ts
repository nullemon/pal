import { MAX_SLUG_LENGTH } from '@palscans/core'
import { z } from 'zod'

/**
 * Admin → Content → Genres. The slug rule is the strict one from `@palscans/core` rather
 * than "anything the citext column accepts": this value becomes a public URL, and a slug
 * with a space or a capital in it is a page nobody can link to twice the same way.
 */
export const genreSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(MAX_SLUG_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

export const genreKindSchema = z.enum(['genre', 'theme', 'format'])

export const genreWriteSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** Empty means "generate it from the name" — resolved by the route, never by the browser. */
  slug: z.union([genreSlugSchema, z.literal('')]).optional(),
  kind: genreKindSchema,
})
export type GenreWriteInput = z.infer<typeof genreWriteSchema>

export const genreReorderSchema = z.object({
  kind: genreKindSchema,
  ids: z.array(z.number().int().positive()).min(1).max(500),
})

export const genreMergeSchema = z.object({
  winnerId: z.number().int().positive(),
  loserId: z.number().int().positive(),
})

export const genreRestoreSchema = z.object({ action: z.literal('restore') })

/**
 * A unique-violation on `genres.slug`.
 *
 * Both write routes check the slug before writing, but the check and the write are two
 * statements: two operators naming the same genre at the same moment both pass the check and
 * one of them loses on the index. The index is the authority — this only turns its error
 * into the same 409 the pre-check would have given, instead of a 500.
 */
export const isSlugConflict = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code
  if (code === '23505') return true
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /duplicate key|unique constraint/i.test(message) && /genres_slug/i.test(message)
}

/**
 * A unique-violation on `chapters_series_number_language_unique`.
 *
 * Renumbering a chapter onto a number its series already uses is an ordinary operator
 * mistake — they are looking at a list and typing — and it reached the index as an unhandled
 * error, so the panel showed a 500 and the only clue was in the container log. Same shape as
 * the slug conflict above: the index is the authority, this just turns its verdict into the
 * 409 the operator can act on.
 *
 * The chain is walked rather than the top error inspected, because Drizzle wraps the driver
 * error: the outer message is `Failed query: update "chapters" set …`, which carries neither
 * the SQLSTATE nor the constraint name. Both are on the cause. Checking only the top is why
 * the first version of this returned false for the very error it was written for.
 */
export const isChapterNumberConflict = (error: unknown): boolean => {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code
    const message = current instanceof Error ? current.message : String(current ?? '')
    const named = /chapters_series_(number_language_)?unique|chapters_series_id_number/i.test(
      message,
    )
    if (code === '23505' && (named || /duplicate key|unique constraint/i.test(message))) return true
    if (named && /duplicate key|unique constraint/i.test(message)) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}
