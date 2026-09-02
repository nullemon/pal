import { z } from 'zod'

/**
 * Server-side environment, parsed once. Keys mirror `.env.example`; the ones commented out
 * there are optional. Import only from server code (route handlers, server components,
 * server actions) — never from a client component.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // database
  DATABASE_URL: z.string().min(1).default('pglite://./.data/pg'),

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

const productionSchema = envSchema.superRefine((env, ctx) => {
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
})

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  // `next build` runs with NODE_ENV=production but serves nothing; the secret checks apply
  // to the running server (`next start`), where a placeholder secret would be exploitable.
  const building = source.NEXT_PHASE === 'phase-production-build'
  const result = (building ? envSchema : productionSchema).safeParse(withoutEmpty(source))
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
