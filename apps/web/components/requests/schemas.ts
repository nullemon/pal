import { z } from 'zod'
import { SERIES_TYPES } from '@/components/discovery/taxonomy'

/**
 * The request board's untrusted-input schemas — server-side only.
 *
 * Split out of `./shared` rather than living beside the view models because the islands
 * that import those models are reachable from the site header, and a zod import there puts
 * 84 KB gzipped on every page (docs/20). Route handlers import this; client components must
 * not, and there is nothing here they would gain by it.
 */

const trimmed = z.string().trim()

/**
 * Alternative titles arrive as one textarea. Splitting server-side (rather than asking the
 * client for an array) means the cap is enforced where it matters.
 */
const altTitles = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) =>
    (typeof v === 'string' ? v.split(/\r?\n/) : (v ?? []))
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10)
      .map((s) => s.slice(0, 200)),
  )

export const createRequestSchema = z.object({
  title: trimmed.min(2).max(200),
  altTitles,
  /** `http(s)` only, and only as a pointer for staff — it is never rendered as a link
   *  the site vouches for. */
  link: z
    .union([z.literal(''), z.string().trim().url().max(500)])
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^https?:\/\//i.test(v), 'link must be http(s)'),
  type: z
    .union([z.literal(''), z.enum(SERIES_TYPES)])
    .optional()
    .transform((v) => (v ? v : null)),
  note: z
    .union([z.literal(''), trimmed.max(1000)])
    .optional()
    .transform((v) => (v ? v : null)),
  /** Cloudflare Turnstile token; required for anonymous submissions when configured. */
  turnstile: z.string().max(4096).optional(),
  /** Honeypot — a real browser leaves it empty. */
  website: z.string().max(0).optional(),
})

export type CreateRequestBody = z.input<typeof createRequestSchema>

export const suggestQuerySchema = z.object({
  q: trimmed.min(1).max(200),
})

export const voteSchema = z.object({
  /** false withdraws the vote. */
  vote: z.boolean().default(true),
})
