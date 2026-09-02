import { COMMENT_MAX_CHARS, commentBodySchema } from '@palscans/core/comments'
import { z } from 'zod'
import { COMMENT_SORTS, REACTION_KINDS, REPORT_REASONS } from './types'

export const targetSchema = z.string().regex(/^(series|chapter):\d{1,12}$/)

/** Deepest offset a listing accepts — past this the query would be an out-of-range OFFSET. */
export const MAX_CURSOR = 10_000

export const listQuerySchema = z.object({
  target: targetSchema,
  sort: z.enum(COMMENT_SORTS).default('best'),
  cursor: z.coerce.number().int().min(0).max(MAX_CURSOR).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export const createCommentSchema = z.object({
  /** Turnstile token (docs/14 §2 step 3) — required only when the server asks for a challenge. */
  turnstile: z.string().max(2048).optional(),
  target: targetSchema,
  parent_id: z.number().int().positive().nullable().optional(),
  body: commentBodySchema,
  image_id: z.number().int().positive().nullable().optional(),
  is_spoiler: z.boolean().optional(),
})

export const editCommentSchema = z.object({
  body: commentBodySchema,
  is_spoiler: z.boolean().optional(),
})

export const reactionSchema = z.object({ kind: z.enum(REACTION_KINDS) })

export const reportSchema = z.object({
  reason: z.enum(REPORT_REASONS),
  detail: z.string().trim().max(1000).optional(),
})

export const idParamSchema = z.coerce.number().int().positive()

export const mentionQuerySchema = z.object({ q: z.string().trim().min(1).max(32) })

export const imageQuerySchema = z.object({ q: z.string().trim().max(40).optional() })

export const bookmarkSchema = z.object({
  status: z.enum(['reading', 'planned', 'completed', 'paused', 'dropped']).default('reading'),
})

export const ratingSchema = z.object({ score: z.number().int().min(1).max(10) })

export const MAX_CHARS = COMMENT_MAX_CHARS
