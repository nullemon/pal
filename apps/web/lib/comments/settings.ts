import type { Db } from '@palscans/db'
import { commentSettings } from '@palscans/db'
import { z } from 'zod'

/** docs/14 §3 "Settings" — the singleton key/value table, merged over these defaults. */
export const commentSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  require_verified_email: z.boolean().default(true),
  min_account_age_minutes: z.number().int().min(0).default(10),
  hold_links: z.boolean().default(true),
  hold_new_accounts_hours: z.number().min(0).default(24),
  hold_new_accounts_first_n: z.number().int().min(0).default(3),
  images: z
    .object({
      collection: z.boolean().default(true),
      custom_gifs: z.enum(['off', 'premium', 'all']).default('premium'),
    })
    .default({ collection: true, custom_gifs: 'premium' }),
  max_mentions: z.number().int().min(0).default(5),
  edit_window_minutes: z.number().int().min(0).default(15),
  collapse_threshold: z.number().int().default(-5),
  rate_limits: z
    .object({
      per_minute: z.number().int().min(1).default(5),
      per_hour: z.number().int().min(1).default(60),
      new_per_minute: z.number().int().min(1).default(2),
      new_per_hour: z.number().int().min(1).default(20),
    })
    .default({ per_minute: 5, per_hour: 60, new_per_minute: 2, new_per_hour: 20 }),
  automod: z
    .object({ hold: z.number().default(6), shadow: z.number().default(10) })
    .default({ hold: 6, shadow: 10 }),
  auto_lock_days: z.number().int().nullable().default(null),
  report_threshold: z
    .object({ unique: z.number().int().default(5), premium: z.number().int().default(2) })
    .default({ unique: 5, premium: 2 }),
  lockdown: z.boolean().default(false),
})

export type CommentSettings = z.infer<typeof commentSettingsSchema>

export const DEFAULT_COMMENT_SETTINGS: CommentSettings = commentSettingsSchema.parse({})

/** Parse a raw key/value map (unknown values from the table) into settings, ignoring junk. */
export const parseCommentSettings = (raw: Record<string, unknown>): CommentSettings => {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(commentSettingsSchema.shape)) {
    const field = commentSettingsSchema.shape[key as keyof typeof commentSettingsSchema.shape]
    const parsed = field.safeParse(raw[key])
    if (parsed.success) out[key] = parsed.data
  }
  return commentSettingsSchema.parse(out)
}

const TTL_MS = 60_000
let cached: { at: number; value: CommentSettings } | undefined

/** Comment settings, cached in-process for a minute (admin edits are rare, reads are hot). */
export const loadCommentSettings = async (db: Db, now = Date.now()): Promise<CommentSettings> => {
  if (cached && now - cached.at < TTL_MS) return cached.value
  const rows = await db
    .select({ key: commentSettings.key, value: commentSettings.value })
    .from(commentSettings)
  const raw: Record<string, unknown> = {}
  for (const r of rows) raw[r.key] = r.value
  const value = parseCommentSettings(raw)
  cached = { at: now, value }
  return value
}

export const resetCommentSettingsCache = (): void => {
  cached = undefined
}
