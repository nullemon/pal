import { describe, expect, it } from 'vitest'
import { hashSessionSecret, parseSessionCookie } from './session'

describe('parseSessionCookie', () => {
  it('splits a well-formed cookie into id and secret', () => {
    const parsed = parseSessionCookie(
      '5f4b2c1a-9d8e-4f3a-b2c1-0a9b8c7d6e5f.QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU',
    )
    expect(parsed).toEqual({
      id: '5f4b2c1a-9d8e-4f3a-b2c1-0a9b8c7d6e5f',
      secret: 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU',
    })
  })

  it('rejects malformed values', () => {
    expect(parseSessionCookie(undefined)).toBeNull()
    expect(parseSessionCookie('')).toBeNull()
    expect(parseSessionCookie('not-a-uuid.secretsecretsecretsecretsecret1234')).toBeNull()
    expect(parseSessionCookie('5f4b2c1a-9d8e-4f3a-b2c1-0a9b8c7d6e5f')).toBeNull()
    expect(parseSessionCookie('5f4b2c1a-9d8e-4f3a-b2c1-0a9b8c7d6e5f.short')).toBeNull()
  })

  it('hashes secrets to 32 bytes deterministically', () => {
    const a = hashSessionSecret('abc')
    expect(a.byteLength).toBe(32)
    expect(Buffer.from(a).toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})
