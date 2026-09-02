import { describe, expect, it } from 'vitest'
import { ipAllowed } from './ip-allowlist'

describe('ipAllowed (docs/17 §C panel allowlist)', () => {
  it('matches a plain IPv4 address', () => {
    expect(ipAllowed('203.0.113.7', ['203.0.113.7'])).toBe(true)
    expect(ipAllowed('203.0.113.8', ['203.0.113.7'])).toBe(false)
  })
  it('matches an IPv4 CIDR range', () => {
    expect(ipAllowed('203.0.113.42', ['203.0.113.0/24'])).toBe(true)
    expect(ipAllowed('203.0.114.42', ['203.0.113.0/24'])).toBe(false)
    expect(ipAllowed('10.1.2.3', ['10.0.0.0/8'])).toBe(true)
  })
  it('matches IPv6, compressed or not', () => {
    expect(ipAllowed('2001:db8::1', ['2001:db8::1'])).toBe(true)
    expect(ipAllowed('2001:db8::dead', ['2001:db8::/32'])).toBe(true)
    expect(ipAllowed('2001:db9::dead', ['2001:db8::/32'])).toBe(false)
  })
  it('never allows on a malformed entry, and an empty list allows nobody', () => {
    expect(ipAllowed('203.0.113.7', ['not-an-ip'])).toBe(false)
    expect(ipAllowed('203.0.113.7', ['203.0.113.0/99'])).toBe(false)
    expect(ipAllowed('203.0.113.7', [])).toBe(false)
  })
  it('does not confuse address families', () => {
    expect(ipAllowed('203.0.113.7', ['2001:db8::/32'])).toBe(false)
    expect(ipAllowed('2001:db8::1', ['203.0.113.0/24'])).toBe(false)
  })
})
