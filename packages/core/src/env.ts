import { z } from 'zod'

/**
 * Process environment, parsed once with zod (docs/16 "Validation": zod for every input
 * and for env parsing). Every module that needs configuration reads it through `getEnv()`
 * instead of touching `process.env` directly.
 */
export const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .regex(/^(postgres(ql)?|pglite):\/\//, 'DATABASE_URL must start with postgres:// or pglite://')
    .default('pglite://.data/pglite'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  REDIS_URL: z.string().url().optional(),
  STORAGE_DRIVER: z.enum(['fs', 's3']).default('fs'),
  STORAGE_FS_ROOT: z.string().default('.data/storage'),
  PUBLIC_CDN_URL: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** "true" / "1" / "yes" → true; "false" / "0" / "no" → false. */
  S3_FORCE_PATH_STYLE: z.stringbool().optional(),
  // apps/worker knobs (mirrored in .env.example)
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),
  WORKER_PAGE_CONCURRENCY: z.coerce.number().int().positive().default(4),
  WORKER_SCHEDULER_MS: z.coerce.number().int().positive().default(30_000),
  /** How often the worker enqueues `stats.rollup` (docs/02: "every few minutes"). */
  WORKER_ROLLUP_MS: z.coerce.number().int().positive().default(120_000),
})

export type Env = z.infer<typeof envSchema>

let cached: Env | undefined

/** The parsed environment, memoised for the life of the process. Throws on invalid values. */
export const getEnv = (): Env => {
  cached ??= envSchema.parse(process.env)
  return cached
}

/** Drop the memoised environment (tests that mutate `process.env`). */
export const resetEnv = (): void => {
  cached = undefined
}
