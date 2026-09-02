import { z } from 'zod'

/**
 * D · Notifications (docs/17 §D) — environment, parsed on its own.
 *
 * This module is imported by **both** `apps/web` and `apps/worker`, so it deliberately does
 * not go through `@/lib/env`: that schema carries the web app's production assertions (https
 * SITE_URL, a trusted proxy…) which have nothing to say about a background process. It reads
 * only the keys this feature owns, and every one of them is optional — with none set, web
 * push and Discord are simply *not configured*: no route throws, no job sends, and every
 * surface says so.
 */
export const notificationEnvSchema = z.object({
  /** VAPID application server keys (`npx web-push generate-vapid-keys`). */
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  /** `mailto:` or `https:` contact the push service can reach you on. */
  VAPID_SUBJECT: z.string().min(1).optional(),
  /** Discord bot token — gates account linking, role sync and DMs (channel webhooks do not need it). */
  DISCORD_BOT_TOKEN: z.string().min(1).optional(),
  /** Guild the tier roles live in; role ids come from the admin screen. */
  DISCORD_GUILD_ID: z.string().min(1).optional(),
})

export type NotificationEnv = z.infer<typeof notificationEnvSchema>

const strip = (source: Record<string, string | undefined>): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(source)) if (v !== undefined && v !== '') out[k] = v
  return out
}

/** Parsed once per process; pass a source to override in tests. */
let cached: NotificationEnv | undefined
export const notificationEnv = (source?: Record<string, string | undefined>): NotificationEnv => {
  if (source) return notificationEnvSchema.parse(strip(source))
  cached ??= notificationEnvSchema.parse(strip(process.env))
  return cached
}

/** Tests that mutate `process.env`. */
export const resetNotificationEnv = (): void => {
  cached = undefined
}

export interface PushConfig {
  publicKey: string
  privateKey: string
  subject: string
}

export interface ChannelStatus {
  configured: boolean
  /** Which env keys are missing, for the "not configured" panels. */
  missing: readonly string[]
}

/** Web push needs both VAPID keys; the subject falls back to a mailto for the site. */
export const pushStatus = (env: NotificationEnv = notificationEnv()): ChannelStatus => {
  const missing: string[] = []
  if (!env.VAPID_PUBLIC_KEY) missing.push('VAPID_PUBLIC_KEY')
  if (!env.VAPID_PRIVATE_KEY) missing.push('VAPID_PRIVATE_KEY')
  return { configured: missing.length === 0, missing }
}

export const pushConfig = (env: NotificationEnv = notificationEnv()): PushConfig | null => {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT ?? 'mailto:no-reply@palscans.org',
  }
}

/**
 * Discord splits in two: **channel webhooks** are just a URL and work with no token at all,
 * while **linking, role sync and DMs** speak to the API as a bot and need `DISCORD_BOT_TOKEN`
 * (plus a guild for roles). Each surface asks for the half it needs.
 */
export const discordStatus = (env: NotificationEnv = notificationEnv()): ChannelStatus => {
  const missing: string[] = []
  if (!env.DISCORD_BOT_TOKEN) missing.push('DISCORD_BOT_TOKEN')
  return { configured: missing.length === 0, missing }
}

export const discordRoleSyncStatus = (env: NotificationEnv = notificationEnv()): ChannelStatus => {
  const missing: string[] = []
  if (!env.DISCORD_BOT_TOKEN) missing.push('DISCORD_BOT_TOKEN')
  if (!env.DISCORD_GUILD_ID) missing.push('DISCORD_GUILD_ID')
  return { configured: missing.length === 0, missing }
}
