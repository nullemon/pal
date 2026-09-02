import { z } from 'zod'

/**
 * zod shapes shared by the admin islands and the /api/admin route handlers. Client-safe:
 * no database imports.
 */

export const seriesTypeSchema = z.enum(['manga', 'manhwa', 'manhua', 'comic', 'novel'])
export const seriesStatusSchema = z.enum(['ongoing', 'completed', 'hiatus', 'cancelled', 'dropped'])
export const pubStateSchema = z.enum(['draft', 'scheduled', 'published', 'unlisted', 'removed'])
export const readingDirectionSchema = z.enum(['ltr', 'rtl', 'vertical'])
export const creditSchema = z.enum(['author', 'artist', 'translator'])

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable()

export const seriesDocSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80),
  type: seriesTypeSchema,
  status: seriesStatusSchema,
  state: pubStateSchema,
  synopsis: nullableText(8000),
  releasedYear: z.number().int().min(1900).max(2100).nullable(),
  serialization: nullableText(200),
  ageRating: z.enum(['all', 'teen', 'mature']).nullable(),
  readingDirection: readingDirectionSchema,
  releaseSchedule: z
    .object({
      weekday: z.number().int().min(0).max(6),
      time: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional(),
      tz: z.string().max(64).optional(),
      note: z.string().max(120).optional(),
    })
    .nullable(),
  contentWarnings: z.array(z.string().trim().min(1).max(60)).max(20),
  titles: z
    .array(z.object({ title: z.string().trim().min(1).max(200), lang: nullableText(16) }))
    .max(60),
  people: z
    .array(
      z.object({
        credit: creditSchema,
        name: z.string().trim().min(1).max(120),
        id: z.number().int().nullable(),
      }),
    )
    .max(30),
  genreIds: z.array(z.number().int().positive()).max(60),
  linkedSeriesId: z.number().int().positive().nullable(),
  isFeatured: z.boolean(),
  isPinned: z.boolean(),
  commentsEnabled: z.boolean(),
  geo: z.object({
    mode: z.enum(['allow', 'block']),
    countries: z
      .array(
        z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{2}$/),
      )
      .max(250),
  }),
  seoTitle: nullableText(120),
  seoDescription: nullableText(320),
  focusKeyword: nullableText(80),
  seoText: nullableText(10_000),
  noindex: z.boolean(),
  canonicalUrl: nullableText(500),
  ogImageKey: nullableText(300),
})
export type SeriesDoc = z.infer<typeof seriesDocSchema>

export const seriesCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  type: seriesTypeSchema,
})

export const artKindSchema = z.enum(['cover', 'banner'])

export const artIntentSchema = z.object({
  kind: artKindSchema,
  name: z.string().min(1).max(200),
  bytes: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
})

export const artConfirmSchema = z.object({ kind: artKindSchema, key: z.string().min(1).max(300) })

export const chapterPatchSchema = z
  .object({
    number: z.number().min(0).max(99_999),
    title: nullableText(200),
    volume: z.number().int().min(0).max(999).nullable(),
    isPremium: z.boolean(),
    earlyAccessUntil: z.string().datetime({ offset: true }).nullable(),
    publishedAt: z.string().datetime({ offset: true }).nullable(),
    state: z.enum(['draft', 'ready', 'scheduled', 'published']),
  })
  .partial()

export const bulkActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('publish_now'), ids: z.array(z.number().int()).min(1).max(500) }),
  z.object({
    action: z.literal('schedule'),
    ids: z.array(z.number().int()).min(1).max(500),
    publishedAt: z.string().datetime({ offset: true }),
  }),
  z.object({ action: z.literal('set_premium'), ids: z.array(z.number().int()).min(1).max(500) }),
  z.object({ action: z.literal('clear_premium'), ids: z.array(z.number().int()).min(1).max(500) }),
  z.object({
    action: z.literal('early_access'),
    ids: z.array(z.number().int()).min(1).max(500),
    earlyAccessUntil: z.string().datetime({ offset: true }).nullable(),
  }),
  z.object({ action: z.literal('delete'), ids: z.array(z.number().int()).min(1).max(500) }),
  z.object({ action: z.literal('restore'), ids: z.array(z.number().int()).min(1).max(500) }),
])
export type BulkAction = z.infer<typeof bulkActionSchema>

/** Upload manifest (docs/03 step 3): one entry per chapter with its files. */
export const uploadFileSchema = z.object({
  name: z.string().min(1).max(300),
  bytes: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']),
})

export const uploadIntentSchema = z.object({
  seriesId: z.number().int().positive(),
  chapters: z
    .array(
      z.object({
        number: z.number().min(0).max(99_999),
        title: nullableText(200).optional(),
        files: z.array(uploadFileSchema).min(1).max(400),
      }),
    )
    .min(1)
    .max(100),
})
export type UploadIntent = z.infer<typeof uploadIntentSchema>

export const uploadCommitSchema = z.object({
  chapterId: z.number().int().positive(),
  keys: z.array(z.string().min(1).max(300)).min(1).max(400),
  after: z
    .object({
      mode: z.enum(['ready', 'publish', 'schedule']),
      publishedAt: z.string().datetime({ offset: true }).nullable().optional(),
      isPremium: z.boolean().optional(),
    })
    .optional(),
})
export type UploadCommit = z.infer<typeof uploadCommitSchema>

export const MAX_PAGES_PER_CHAPTER = 400
/** Mirrors `MAX_ORIGINAL_BYTES` in @palscans/core/storage (this file stays client-safe). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024
export const MAX_CHAPTER_BYTES = 1024 * 1024 * 1024
