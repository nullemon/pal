import { z } from 'zod'
import { messages } from '../messages.js'
import {
  type BlockNode,
  bodyDepth,
  COMMENT_MAX_BLOCKS,
  COMMENT_MAX_CHARS,
  COMMENT_MAX_HREF,
  COMMENT_MAX_INLINE,
  COMMENT_MAX_INLINE_DEPTH,
  COMMENT_MAX_QUOTE_DEPTH,
  COMMENT_MAX_USERNAME,
  type CommentBody,
  type InlineNode,
} from './body.js'
import { safeHref } from './render.js'

/**
 * Zod schemas for untrusted comment bodies — the server's parse step.
 *
 * Deliberately *not* re-exported from `@palscans/core/comments`: the composer and the
 * comment renderer are client components and import that barrel for `plainText`,
 * `hasSpoiler` and the length caps. Re-exporting these would put zod (83 KB gzipped, and
 * the whole `messages` catalogue with it) into every reader's browser for validation that
 * only ever runs on the server. Route handlers import `@palscans/core/comments/schema`.
 */

const markSchema = z.enum(['bold', 'italic', 'strike', 'code'])

export const inlineNodeSchema: z.ZodType<InlineNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('text'),
      text: z.string().max(COMMENT_MAX_CHARS),
      marks: z.array(markSchema).max(4).optional(),
    }),
    z.object({
      type: z.literal('spoiler'),
      children: z.array(inlineNodeSchema).max(COMMENT_MAX_INLINE),
    }),
    z.object({
      type: z.literal('link'),
      href: z
        .string()
        .max(COMMENT_MAX_HREF)
        .refine((h) => safeHref(h) !== null, messages.commentThread.linkScheme),
      children: z.array(inlineNodeSchema).max(COMMENT_MAX_INLINE),
    }),
    z.object({
      type: z.literal('mention'),
      username: z.string().max(COMMENT_MAX_USERNAME),
      userId: z.number().int().optional(),
    }),
    z.object({ type: z.literal('hard_break') }),
  ]),
)

export const blockNodeSchema: z.ZodType<BlockNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('paragraph'),
      children: z.array(inlineNodeSchema).max(COMMENT_MAX_INLINE),
    }),
    z.object({
      type: z.literal('quote'),
      commentId: z.number().int().optional(),
      username: z.string().max(COMMENT_MAX_USERNAME).optional(),
      children: z.array(blockNodeSchema).max(COMMENT_MAX_BLOCKS),
    }),
    z.object({
      type: z.literal('image'),
      imageId: z.number().int(),
      alt: z.string().max(200).optional(),
    }),
  ]),
)

/** The stored/submitted body shape. Route handlers parse untrusted input with this. */
export const commentBodySchema: z.ZodType<CommentBody> = z
  .object({
    type: z.literal('doc'),
    version: z.literal(1),
    children: z.array(blockNodeSchema).max(COMMENT_MAX_BLOCKS),
  })
  .superRefine((doc, ctx) => {
    const depth = bodyDepth(doc)
    if (depth.quote > COMMENT_MAX_QUOTE_DEPTH)
      ctx.addIssue({
        code: 'custom',
        message: messages.commentThread.quoteTooDeep,
        path: ['children'],
      })
    if (depth.inline > COMMENT_MAX_INLINE_DEPTH)
      ctx.addIssue({
        code: 'custom',
        message: messages.commentThread.formattingTooDeep,
        path: ['children'],
      })
  })

/** Structural validation of an untrusted body. Does not check length — see `plainText`. */
export const isCommentBody = (v: unknown): v is CommentBody =>
  commentBodySchema.safeParse(v).success
