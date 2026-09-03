import { describe, expect, it } from 'vitest'
import { open, SealingKeyMissingError, seal, sealingKeySource, secretEquals } from '../secrets.js'

const KEY = { CREDENTIALS_KEY: 'a'.repeat(44) } as NodeJS.ProcessEnv
const OTHER = { CREDENTIALS_KEY: 'b'.repeat(44) } as NodeJS.ProcessEnv

describe('credential sealing', () => {
  it('round-trips a value', () => {
    expect(open(seal('r2-secret-key', KEY), KEY)).toBe('r2-secret-key')
  })

  it('never produces the same ciphertext twice', () => {
    // A fresh nonce per seal, so two accounts using the same password are not visibly equal
    // to anyone reading the table.
    expect(Buffer.from(seal('same', KEY)).equals(Buffer.from(seal('same', KEY)))).toBe(false)
  })

  it('refuses a value sealed under a different key rather than returning junk', () => {
    expect(open(seal('secret', KEY), OTHER)).toBeNull()
  })

  it('rejects a tampered ciphertext', () => {
    const sealed = seal('secret', KEY)
    sealed[sealed.length - 1] ^= 0xff // flip a bit in the auth tag
    expect(open(sealed, KEY)).toBeNull()
  })

  it('returns null for a truncated row instead of throwing', () => {
    expect(open(new Uint8Array(4), KEY)).toBeNull()
  })

  it('falls back to SESSION_SECRET, but not to the placeholder', () => {
    expect(sealingKeySource(KEY)).toBe('CREDENTIALS_KEY')
    expect(sealingKeySource({ SESSION_SECRET: 'x'.repeat(44) } as NodeJS.ProcessEnv)).toBe(
      'SESSION_SECRET',
    )
    expect(
      sealingKeySource({
        SESSION_SECRET: 'change-me-to-32-random-bytes-base64',
      } as NodeJS.ProcessEnv),
    ).toBeNull()
    expect(sealingKeySource({} as NodeJS.ProcessEnv)).toBeNull()
  })

  it('throws a named error when no key is configured', () => {
    expect(() => seal('x', {} as NodeJS.ProcessEnv)).toThrow(SealingKeyMissingError)
  })

  it('compares secrets without leaking length by early exit', () => {
    expect(secretEquals('whsec_abc', 'whsec_abc')).toBe(true)
    expect(secretEquals('whsec_abc', 'whsec_abd')).toBe(false)
    expect(secretEquals('whsec_abc', 'nope')).toBe(false)
  })
})
