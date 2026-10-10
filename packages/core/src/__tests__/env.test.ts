import { describe, expect, it } from 'vitest'
import { envSchema } from '../env.js'

/**
 * Environment parsing, and one specific way to take the whole site down.
 *
 * `getEnv()` throws on an invalid value, and every process calls it during startup — so a
 * schema that refuses a value nobody set does not degrade a feature, it stops web and worker
 * from booting at all. That is not hypothetical: `IMGCHEST_TOKEN: z.string().min(1)
 * .optional()` shipped against a compose file carrying `IMGCHEST_TOKEN: ${IMGCHEST_TOKEN:-}`,
 * which sets the variable to an empty string. `.optional()` permits absent, not blank, so
 * `.min(1)` failed and both containers crash-looped for a token the operator had never
 * configured and did not need.
 *
 * The lesson generalises past that one variable, which is why this test sweeps all of them:
 * an optional variable has to survive being present and empty, because that is how compose,
 * shell exports and CI secrets all represent "not set".
 */

const MINIMAL = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' }

/**
 * Every genuinely optional key — absent is allowed *and* yields undefined.
 *
 * The `data === undefined` half is what separates optional from defaulted. A field with a
 * default also accepts `undefined`, but it is not optional: it has a value to validate, and
 * `DATABASE_URL: ''` should still be refused rather than waved through.
 */
const optionalKeys = Object.entries(envSchema.shape)
  .filter(([, value]) => {
    const parsed = value.safeParse(undefined)
    return parsed.success && parsed.data === undefined
  })
  .map(([key]) => key)

describe('envSchema', () => {
  it('parses a minimal environment', () => {
    expect(envSchema.safeParse(MINIMAL).success).toBe(true)
  })

  it('accepts an empty string for every optional variable', () => {
    // `${VAR:-}` in compose, `export VAR=` in a shell and an unset CI secret all arrive as
    // '' rather than as nothing at all.
    expect(optionalKeys.length).toBeGreaterThan(0)
    for (const key of optionalKeys) {
      const result = envSchema.safeParse({ ...MINIMAL, [key]: '' })
      expect(result.success, `${key} rejected an empty string`).toBe(true)
    }
  })

  it('reads IMGCHEST_TOKEN when it is actually set, and trims it', () => {
    const parsed = envSchema.parse({ ...MINIMAL, IMGCHEST_TOKEN: '  abc123  ' })
    expect(parsed.IMGCHEST_TOKEN).toBe('abc123')
  })

  it('leaves IMGCHEST_TOKEN undefined when blank, so no caller sees an empty token', () => {
    // Every consumer does `if (opts.token)`, so '' would behave correctly by accident. It is
    // undefined here on purpose: the type says "a token or nothing", and '' is neither.
    for (const value of ['', '   ', undefined])
      expect(envSchema.parse({ ...MINIMAL, IMGCHEST_TOKEN: value }).IMGCHEST_TOKEN).toBeUndefined()
  })

  it('still rejects a genuinely invalid value', () => {
    // The point is not that the schema stops checking — only that absent and blank mean the
    // same thing.
    expect(envSchema.safeParse({ DATABASE_URL: 'mysql://nope' }).success).toBe(false)
    expect(envSchema.safeParse({ ...MINIMAL, STORAGE_DRIVER: 'ftp' }).success).toBe(false)
  })
})
