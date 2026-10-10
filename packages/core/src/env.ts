import { z } from 'zod'

/**
 * Process environment, parsed once with zod (docs/16 "Validation": zod for every input
 * and for env parsing). Every module that needs configuration reads it through `getEnv()`
 * instead of touching `process.env` directly.
 */
/**
 * An optional variable where "present but blank" means absent.
 *
 * Every mechanism that sets configuration represents "not set" as an empty string rather
 * than as nothing: `${VAR:-}` in a compose file, `export VAR=` in a shell, an unfilled CI
 * secret, a blank line in `.env`. Zod's `.optional()` permits `undefined`, not `''`, so any
 * optional carrying a format constraint — a URL, a minimum length, a boolean — rejects the
 * blank and `getEnv()` throws.
 *
 * That is not a degraded feature. `getEnv()` runs during startup in every process, so one
 * such variable stops web and worker from booting at all. It happened: `IMGCHEST_TOKEN` was
 * declared `.min(1).optional()` against a compose line that always set it, and both
 * containers crash-looped over a token nobody had configured and nothing needed.
 */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema.optional(),
  )

export const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .regex(/^(postgres(ql)?|pglite):\/\//, 'DATABASE_URL must start with postgres:// or pglite://')
    .default('pglite://.data/pglite'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  REDIS_URL: optional(z.string().url()),
  STORAGE_DRIVER: z.enum(['fs', 's3']).default('fs'),
  STORAGE_FS_ROOT: z.string().default('.data/storage'),
  PUBLIC_CDN_URL: optional(z.string()),
  S3_BUCKET: optional(z.string()),
  S3_ENDPOINT: optional(z.string()),
  S3_REGION: optional(z.string()),
  S3_ACCESS_KEY_ID: optional(z.string()),
  S3_SECRET_ACCESS_KEY: optional(z.string()),
  /** "true" / "1" / "yes" → true; "false" / "0" / "no" → false. */
  S3_FORCE_PATH_STYLE: optional(z.stringbool()),
  // apps/worker knobs (mirrored in .env.example)
  /**
   * Optional ImgChest personal access token.
   *
   * The import does not need one: the gallery page carries the whole post as JSON and is
   * served to anyone. A token switches the worker to the documented API first, which is
   * worth having only as insurance against their markup changing.
   *
   * Blank means absent — see `optional` above, which this variable is the reason for.
   */
  IMGCHEST_TOKEN: optional(z.string().trim().min(1)),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),
  WORKER_PAGE_CONCURRENCY: z.coerce.number().int().positive().default(4),
  WORKER_SCHEDULER_MS: z.coerce.number().int().positive().default(30_000),
  /** How often the worker enqueues `stats.rollup` (docs/02: "every few minutes"). */
  WORKER_ROLLUP_MS: z.coerce.number().int().positive().default(120_000),
  /**
   * How long a SIGTERM gives in-flight work to finish before the worker exits anyway.
   * A page encode is the long pole, so this is minutes-tolerant rather than seconds; the
   * compose `stop_grace_period` for the worker must be larger, or Docker sends SIGKILL first
   * and the drain never completes.
   */
  WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
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
