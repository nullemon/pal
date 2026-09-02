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

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(withoutEmpty(source))
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
