import { describe, expect, it } from 'vitest'
import {
  bearerToken,
  hashSecret,
  KEY_PREFIX,
  keyIsUsable,
  mintApiKey,
  parseApiKey,
} from './api-keys'

/**
 * API keys. The database half is a single indexed read; what is worth pinning down is the
 * token format, what counts as a usable key, and that nothing here ever holds the secret.
 */
describe('minting', () => {
  it('produces scheme, prefix and secret, in that order', () => {
    const { token, prefix } = mintApiKey()
    expect(token.startsWith(`${KEY_PREFIX}_${prefix}_`)).toBe(true)
    expect(prefix).toMatch(/^[0-9a-f]{12}$/)
  })

  it('round-trips a secret containing an underscore', () => {
    // The secret is base64url and that alphabet includes `_`. Splitting the token on every
    // underscore would reject roughly a third of all keys — and only those, intermittently.
    const parsed = parseApiKey('pal_abc123def456_aa_bb-cc_dd')
    expect(parsed).toEqual({ prefix: 'abc123def456', secret: 'aa_bb-cc_dd' })
  })

  it('stores the hash of the secret and never the secret', () => {
    const { token, prefix, secretHash } = mintApiKey()
    const secret = token.slice(`${KEY_PREFIX}_${prefix}_`.length)
    expect(secret.length).toBeGreaterThan(20)
    expect(Buffer.from(secretHash)).toEqual(Buffer.from(hashSecret(secret)))
    // The hash must not contain the secret in any readable form.
    expect(Buffer.from(secretHash).toString('utf8')).not.toContain(secret)
  })

  it('never repeats a prefix or a secret', () => {
    const keys = Array.from({ length: 50 }, () => mintApiKey())
    expect(new Set(keys.map((k) => k.prefix)).size).toBe(50)
    expect(new Set(keys.map((k) => k.token)).size).toBe(50)
  })
})

describe('parsing a presented token', () => {
  it('accepts one we minted', () => {
    const { token, prefix } = mintApiKey()
    expect(parseApiKey(token)?.prefix).toBe(prefix)
  })

  it('refuses anything that is not ours, rather than throwing', () => {
    // A bearer that is not a key at all must parse as null so `withPermission` falls through
    // to the cookie instead of answering 401 — that is what keeps INTERNAL_API_SECRET working.
    expect(parseApiKey('sk_live_somethingelse')).toBeNull()
    expect(parseApiKey('pal_nothex_secret')).toBeNull()
    expect(parseApiKey('pal_abc123')).toBeNull()
    expect(parseApiKey('pal__secret')).toBeNull()
    expect(parseApiKey('')).toBeNull()
    expect(parseApiKey(null)).toBeNull()
    expect(parseApiKey(undefined)).toBeNull()
  })
})

describe('reading the header', () => {
  const req = (headers: Record<string, string>) => new Request('http://x/', { headers })

  it('takes the token out of an Authorization header, whatever the case', () => {
    expect(bearerToken(req({ authorization: 'Bearer pal_aa_bb' }))).toBe('pal_aa_bb')
    expect(bearerToken(req({ authorization: 'bearer   pal_aa_bb  ' }))).toBe('pal_aa_bb')
  })

  it('is null when there is no bearer to read', () => {
    expect(bearerToken(req({}))).toBeNull()
    expect(bearerToken(req({ authorization: 'Basic abc' }))).toBeNull()
  })
})

describe('whether a stored key may still be used', () => {
  const now = new Date('2026-09-24T12:00:00Z')

  it('accepts a live key with no expiry', () => {
    expect(keyIsUsable({ revokedAt: null, expiresAt: null }, now)).toBe(true)
  })

  it('refuses a revoked key even if it has not expired', () => {
    expect(keyIsUsable({ revokedAt: new Date('2026-09-01T00:00:00Z'), expiresAt: null }, now)).toBe(
      false,
    )
  })

  it('refuses one that is past its expiry', () => {
    expect(keyIsUsable({ revokedAt: null, expiresAt: new Date('2026-09-24T11:59:59Z') }, now)).toBe(
      false,
    )
  })

  it('accepts one that expires later today', () => {
    expect(keyIsUsable({ revokedAt: null, expiresAt: new Date('2026-09-24T23:00:00Z') }, now)).toBe(
      true,
    )
  })
})
