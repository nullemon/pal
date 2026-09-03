import { credentialValues } from '@palscans/core'
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
 *
 * docs/19 adds a second source in front of that one: the operator can type these keys into
 * Admin → System → Integrations instead of the environment. Both apps read them through
 * `@palscans/core`'s credential slot — the web installs the panel store behind it
 * (`lib/config/resolver.ts`), the worker its own reader (`apps/worker/src/lib/config.ts`) —
 * which is why the status functions below are async. With no resolver installed the slot is
 * empty and every one of them falls back to exactly the environment it read before.
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

/** Registry id ↔ environment variable, one place, used by every resolver below. */
const CREDENTIAL_KEYS = {
  VAPID_PUBLIC_KEY: ['push.vapid_public_key', 'VAPID_PUBLIC_KEY'],
  VAPID_PRIVATE_KEY: ['push.vapid_private_key', 'VAPID_PRIVATE_KEY'],
  VAPID_SUBJECT: ['push.vapid_subject', 'VAPID_SUBJECT'],
  DISCORD_BOT_TOKEN: ['discord.bot_token', 'DISCORD_BOT_TOKEN'],
  DISCORD_GUILD_ID: ['discord.guild_id', 'DISCORD_GUILD_ID'],
} as const satisfies Record<keyof NotificationEnv, readonly [string, string]>

/**
 * The effective settings: the operator's panel values where they are set, the environment
 * everywhere else. An empty string means unset, exactly as it does in a `.env` file, so
 * every "is this configured?" check below reads the same either way.
 */
export const resolveNotificationEnv = async (): Promise<NotificationEnv> =>
  notificationEnvSchema.parse(strip(await credentialValues(CREDENTIAL_KEYS)))

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

/**
 * Web push needs both VAPID keys; the subject falls back to a mailto for the site.
 *
 * `missing` names the **environment variables**, not the registry ids, because that is what
 * the "not configured" copy in `messages.ts` tells the operator to set — and the environment
 * still works. The panel labels the same fields.
 */
export const pushStatusOf = (env: NotificationEnv): ChannelStatus => {
  const missing: string[] = []
  if (!env.VAPID_PUBLIC_KEY) missing.push('VAPID_PUBLIC_KEY')
  if (!env.VAPID_PRIVATE_KEY) missing.push('VAPID_PRIVATE_KEY')
  return { configured: missing.length === 0, missing }
}

export const pushConfigOf = (env: NotificationEnv): PushConfig | null => {
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
export const discordStatusOf = (env: NotificationEnv): ChannelStatus => {
  const missing: string[] = []
  if (!env.DISCORD_BOT_TOKEN) missing.push('DISCORD_BOT_TOKEN')
  return { configured: missing.length === 0, missing }
}

export const discordRoleSyncStatusOf = (env: NotificationEnv): ChannelStatus => {
  const missing: string[] = []
  if (!env.DISCORD_BOT_TOKEN) missing.push('DISCORD_BOT_TOKEN')
  if (!env.DISCORD_GUILD_ID) missing.push('DISCORD_GUILD_ID')
  return { configured: missing.length === 0, missing }
}

/**
 * The resolved forms every caller uses. Each takes an optional settings object so a test (or
 * a caller that already resolved once) stays synchronous underneath; with none it reads the
 * panel store, falling back to the environment.
 */
export const pushStatus = async (env?: NotificationEnv): Promise<ChannelStatus> =>
  pushStatusOf(env ?? (await resolveNotificationEnv()))

export const pushConfig = async (env?: NotificationEnv): Promise<PushConfig | null> =>
  pushConfigOf(env ?? (await resolveNotificationEnv()))

export const discordStatus = async (env?: NotificationEnv): Promise<ChannelStatus> =>
  discordStatusOf(env ?? (await resolveNotificationEnv()))

export const discordRoleSyncStatus = async (env?: NotificationEnv): Promise<ChannelStatus> =>
  discordRoleSyncStatusOf(env ?? (await resolveNotificationEnv()))
