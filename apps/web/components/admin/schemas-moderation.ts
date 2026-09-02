import { z } from 'zod'

const ids = z.array(z.number().int().positive()).min(1).max(200)

export const commentActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('approve_allowlist') }),
  z.object({ action: z.literal('reject'), reason: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal('delete') }),
  z.object({ action: z.literal('pin'), value: z.boolean() }),
  z.object({ action: z.literal('lock'), value: z.boolean() }),
  z.object({ action: z.literal('warn'), message: z.string().trim().min(1).max(500) }),
  z.object({
    action: z.literal('comment_ban'),
    days: z.number().int().min(1).max(3650).nullable(),
  }),
  z.object({ action: z.literal('shadow_ban') }),
  z.object({ action: z.literal('ban'), reason: z.string().trim().max(300).optional() }),
])
export type CommentAction = z.infer<typeof commentActionSchema>

export const commentBulkSchema = z.object({ ids, action: z.enum(['approve', 'reject', 'delete']) })

export const wordFilterSchema = z.object({
  pattern: z.string().trim().min(1).max(200),
  isRegex: z.boolean(),
  action: z.enum(['block', 'hold', 'replace']),
  replacement: z.string().trim().max(100).nullable(),
})

export const allowlistSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/),
})

export const imageActionSchema = z.object({
  action: z.enum(['approve', 'remove', 'collection']),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
})

export const reportActionSchema = z.object({ action: z.enum(['dismiss', 'actioned', 'triaged']) })
