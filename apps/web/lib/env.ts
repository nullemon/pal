import { z } from 'zod'
import {
  discordStatus as discordStatusOf,
  pushStatus as pushStatusOf,
} from './notifications/config'

/**
 * Server-side environment, parsed once. Keys mirror `.env.example`; the ones commented out
 * there are optional. Import only from server code (route handlers, server components,
 * server actions) — never from a client component.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // database
  DATABASE_URL: z.string().min(1).default('pglite://./.data/pg'),
  /** postgres.js pool size (read by @palscans/db; mirrored here so the template stays complete). */
  DATABASE_POOL_MAX: z.coerce.number().int().positive().optional(),

  // cache / queue
  REDIS_URL: z.string().url().optional(),

  // object storage
  STORAGE_DRIVER: z.enum(['fs', 's3']).default('fs'),
  STORAGE_FS_ROOT: z.string().min(1).default('./.data/storage'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).optional(),
  /** MinIO and some S3 clones need path-style URLs ("true" / "1" / "yes"). */
  S3_FORCE_PATH_STYLE: z.stringbool().optional(),
  PUBLIC_CDN_URL: z.string().url().default('http://localhost:3000/_storage'),

  // app
  SITE_URL: z.string().url().default('http://localhost:3000'),
  SITE_NAME: z.string().min(1).default('PALScans'),
  SESSION_SECRET: z.string().min(1).default('change-me-to-32-random-bytes-base64'),
  /**
   * Bearer token for /api/internal/* (worker → web cache purges). Falls back to
   * SESSION_SECRET in development only; production must set it explicitly.
   */
  INTERNAL_API_SECRET: z.string().min(1).optional(),

  /**
   * Which proxy header carries the client address. `none` (default) trusts no header —
   * a forged X-Forwarded-For must never pick a rate-limit bucket; `xff` takes the hop the
   * trusted proxy appended (the last one, or `TRUSTED_PROXY_HOPS` from the end when more
   * than one trusted proxy is in the chain); `cloudflare` reads `cf-connecting-ip`.
   */
  TRUSTED_PROXY: z.enum(['none', 'xff', 'cloudflare']).default('none'),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(10).default(1),

  // bot protection (docs/13); both unset → every Turnstile check passes
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),

  // worker knobs (read by apps/worker through @palscans/core's env; mirrored here for parity)
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),
  WORKER_PAGE_CONCURRENCY: z.coerce.number().int().positive().default(4),
  WORKER_SCHEDULER_MS: z.coerce.number().int().positive().default(30_000),

  // auth providers
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  DISCORD_CLIENT_ID: z.string().min(1).optional(),
  DISCORD_CLIENT_SECRET: z.string().min(1).optional(),

  // payments / email
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
})

export type Env = z.infer<typeof envSchema>

/** Empty strings in .env files mean "unset". */
function withoutEmpty(source: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(source)) {
    if (v !== undefined && v !== '') out[k] = v
  }
  return out
}

/** Minimum SESSION_SECRET length in production (32 random bytes, base64 → 44 chars). */
export const MIN_SESSION_SECRET_LENGTH = 32

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
/** `http://localhost[:port]` and the other loopback literals — secure contexts in every browser. */
export const isLoopbackHttp = (url: string): boolean => {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

/** The runtime checks; `source` is the raw environment (to tell an explicit SITE_URL from the default). */
const productionSchema = (source: Record<string, string | undefined>) =>
  envSchema.superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return
    if (
      env.SESSION_SECRET.length < MIN_SESSION_SECRET_LENGTH ||
      env.SESSION_SECRET.startsWith('change-me')
    )
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: `must be at least ${MIN_SESSION_SECRET_LENGTH} random characters in production (not the placeholder)`,
      })
    if (!env.INTERNAL_API_SECRET)
      ctx.addIssue({
        code: 'custom',
        path: ['INTERNAL_API_SECRET'],
        message: 'is required in production (no fallback to SESSION_SECRET)',
      })
    // With no proxy declared every client shares one rate-limit bucket (and no IP is ever
    // hashed): production must say where the client address comes from.
    if (env.TRUSTED_PROXY === 'none')
      ctx.addIssue({
        code: 'custom',
        path: ['TRUSTED_PROXY'],
        message: 'must be "xff" or "cloudflare" in production (per-IP rate limits need it)',
      })
    // The session / OAuth / MFA cookies carry `Secure` (docs/07); an http:// origin copied from
    // .env.example (TLS at Caddy) must not silently drop it. An *explicit* loopback origin is
    // exempt: browsers treat http://localhost as a secure context (Secure cookies work there),
    // and a production build started on it is a local verification run (`next start -p …`),
    // never a deployment. The unset default (`http://localhost:3000`) is still refused.
    if (!env.SITE_URL.startsWith('https://') && !(source.SITE_URL && isLoopbackHttp(env.SITE_URL)))
      ctx.addIssue({
        code: 'custom',
        path: ['SITE_URL'],
        message: 'must be an https:// origin in production (Secure cookies)',
      })
  })

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  // `next build` runs with NODE_ENV=production but serves nothing; the secret checks apply
  // to the running server (`next start`), where a placeholder secret would be exploitable.
  const building = source.NEXT_PHASE === 'phase-production-build'
  const src = withoutEmpty(source)
  const result = (building ? envSchema : productionSchema(src)).safeParse(src)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment:\n${issues}`)
  }
  const env = result.data
  if (env.STORAGE_DRIVER === 's3') {
    for (const key of [
      'S3_ENDPOINT',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ] as const) {
      if (!env[key])
        throw new Error(`Invalid environment: ${key} is required when STORAGE_DRIVER=s3`)
    }
  }
  return env
}

let cached: Env | undefined

export function getEnv(): Env {
  cached ??= parseEnv()
  return cached
}

/**
 * Billing feature detection (docs/17 §A "Everything is inert without keys"). Stripe needs the
 * secret key to create Checkout / Portal sessions *and* the webhook secret to verify the
 * events that grant entitlements — with either missing the platform must not pretend to sell
 * anything, so `/subscribe`, `/me/billing` and Admin → Premium render a "not configured"
 * state and every billing route answers 503 instead of throwing.
 */
export interface BillingKeyStatus {
  secretKey: boolean
  webhookSecret: boolean
  configured: boolean
}

export const billingKeyStatus = (env: Env = getEnv()): BillingKeyStatus => {
  const secretKey = !!env.STRIPE_SECRET_KEY
  const webhookSecret = !!env.STRIPE_WEBHOOK_SECRET
  return { secretKey, webhookSecret, configured: secretKey && webhookSecret }
}

export const billingConfigured = (env: Env = getEnv()): boolean => billingKeyStatus(env).configured

/**
 * Turnstile feature detection (docs/17 §C). The switch on Admin → System → Access decides
 * whether the challenge is *asked for*; these keys decide whether it can be *shown and
 * verified*. Without both, `verifyTurnstile` passes everything through, so the screen says
 * "not configured" rather than pretending the site is protected.
 */
export const turnstileConfigured = (env: Env = getEnv()): boolean =>
  !!env.TURNSTILE_SECRET_KEY && !!env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

/**
 * Notification feature detection (docs/17 §D). The keys themselves are parsed by
 * `lib/notifications/config.ts` — a schema of its own, because `apps/worker` reads the same
 * variables and must not be subjected to this file's web-server assertions. These re-exports
 * are the entry point web code uses, so "is push configured?" is answered in one place.
 *
 * - **Web push** needs `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY`. Without them the subscribe
 *   panel says "not configured", `/api/push/*` answers 503, and the worker sends nothing.
 * - **Discord** channel webhooks need no key at all; linking, DMs and role sync need
 *   `DISCORD_BOT_TOKEN` (and `DISCORD_GUILD_ID` for roles).
 */
export {
  type ChannelStatus as NotificationChannelStatus,
  discordRoleSyncStatus,
  discordStatus,
  pushConfig,
  pushStatus,
} from './notifications/config'

export const pushConfigured = (): boolean => pushStatusOf().configured
export const discordBotConfigured = (): boolean => discordStatusOf().configured
