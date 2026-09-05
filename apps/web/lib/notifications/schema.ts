import { z } from 'zod'

/**
 * Client-safe half of the notification settings: constants, zod schemas, defaults and the
 * coercer. It imports nothing server-only, so admin and account forms can use it without
 * dragging the database (and its queue) into the browser bundle. Reads and writes live in
 * `./settings`, which re-exports everything here.
 */
/**
 * `settings.notifications` — the operator's half of docs/17 §D, stored the way `ads`,
 * `layouts` and `comments` are (one jsonb row in the generic `settings` table, read through
 * `getSetting`). Credentials never live here: VAPID and the bot token come from the
 * environment, so a database dump carries no secrets.
 */
export const SETTINGS_KEY = 'notifications'

/** Events a Discord channel webhook can carry. */
export const DISCORD_EVENTS = ['new_chapter', 'announcement'] as const
export type DiscordEvent = (typeof DISCORD_EVENTS)[number]

export const DIGEST_FREQUENCIES = ['off', 'daily', 'weekly'] as const
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number]

/** Discord webhook URLs are the one credential the operator pastes in; pin the host. */
export const discordWebhookUrlSchema = z
  .string()
  .trim()
  .url()
  .max(400)
  .refine(
    (u) => /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\//.test(u),
    'must be a https://discord.com/api/webhooks/… URL',
  )

export const discordWebhookSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(60),
  url: discordWebhookUrlSchema,
  events: z.array(z.enum(DISCORD_EVENTS)).max(DISCORD_EVENTS.length),
  enabled: z.boolean(),
})
export type DiscordWebhook = z.infer<typeof discordWebhookSchema>

export const notificationSettingsSchema = z.object({
  push: z.object({
    /** Master switch: off means no push is sent even with VAPID keys present. */
    enabled: z.boolean(),
    /** Copy shown on the reader's subscribe panel is fixed; only the TTL is tunable. */
    ttlSeconds: z.number().int().min(60).max(2_419_200),
  }),
  email: z.object({
    enabled: z.boolean(),
    /** UTC hour a daily digest goes out; the weekly one uses the same hour. */
    hourUtc: z.number().int().min(0).max(23),
    /** 0 = Sunday … 6 = Saturday. */
    weeklyDay: z.number().int().min(0).max(6),
    /** Chapters listed before "and N more". */
    maxItems: z.number().int().min(1).max(50),
  }),
  discord: z.object({
    enabled: z.boolean(),
    webhooks: z.array(discordWebhookSchema).max(10),
    /** DMs to readers who linked their account (needs DISCORD_BOT_TOKEN). */
    dms: z.boolean(),
    roleSync: z.object({
      enabled: z.boolean(),
      /** plan id (`plans.id`) → Discord role id. A missing entry syncs nothing for that plan. */
      roles: z.record(z.string().max(40), z.string().trim().max(40)),
    }),
  }),
})

export type NotificationSettings = z.infer<typeof notificationSettingsSchema>

export const defaultNotificationSettings: NotificationSettings = {
  push: { enabled: true, ttlSeconds: 86_400 },
  email: { enabled: true, hourUtc: 8, weeklyDay: 1, maxItems: 12 },
  discord: { enabled: true, webhooks: [], dms: false, roleSync: { enabled: false, roles: {} } },
}

export const coerceNotificationSettings = (raw: unknown): NotificationSettings => {
  const d = defaultNotificationSettings
  const o = (raw ?? {}) as Record<string, unknown>
  const merged = {
    push: { ...d.push, ...((o.push as object) ?? {}) },
    email: { ...d.email, ...((o.email as object) ?? {}) },
    discord: {
      ...d.discord,
      ...((o.discord as object) ?? {}),
      roleSync: {
        ...d.discord.roleSync,
        ...(((o.discord as { roleSync?: object } | undefined)?.roleSync as object) ?? {}),
      },
    },
  }
  const parsed = notificationSettingsSchema.safeParse(merged)
  return parsed.success ? parsed.data : d
}

// -- per-series follows -------------------------------------------------------------------

/**
 * How loud one followed series is allowed to be (docs/17 §D). The reader-facing half of
 * `series_follows.mode` — the same list the migration's check constraint and
 * `@palscans/db`'s `SERIES_FOLLOW_MODES` carry, kept here so the account screen and the
 * series page can render the picker without importing a database driver.
 *
 *   all    -> in-app, push, Discord, email digest
 *   push   -> in-app, push
 *   in_app -> in-app
 *   digest -> email digest only
 *   off    -> nothing
 *
 * There is no per-chapter *email*: for a new chapter, email is the digest, which is why
 * `digest` is the email row rather than a sixth mode that would send nothing.
 */
export const FOLLOW_MODES = ['all', 'push', 'in_app', 'digest', 'off'] as const
export type FollowMode = (typeof FOLLOW_MODES)[number]

export const DEFAULT_FOLLOW_MODE: FollowMode = 'all'

export const isFollowMode = (v: unknown): v is FollowMode =>
  typeof v === 'string' && (FOLLOW_MODES as readonly string[]).includes(v)

export const followModeSchema = z.enum(FOLLOW_MODES)

/** The table above, as data. `email` is the digest — see the note on `FOLLOW_MODES`. */
const FOLLOW_MODE_CHANNELS: Record<FollowMode, readonly string[]> = {
  all: ['in_app', 'push', 'email', 'discord'],
  push: ['in_app', 'push'],
  in_app: ['in_app'],
  digest: ['email'],
  off: [],
}

/**
 * Does this series' setting let `channel` through? Pure, and deliberately *only* half the
 * decision: every sender ANDs it with `prefAllows`, so a channel the reader turned off
 * globally stays off however loud one series is set.
 */
export const followAllows = (mode: FollowMode, channel: string): boolean =>
  FOLLOW_MODE_CHANNELS[mode].includes(channel)

/** A followed series is in the digest on `all` and `digest`, and nowhere else. */
export const followInDigest = (mode: FollowMode): boolean => followAllows(mode, 'email')
