import { describe, expect, it } from 'vitest'
import { checkHost, isLoopback } from './net-guard'

/**
 * The connection tests make the server connect to an operator-supplied host. Only an admin
 * with TOTP can reach them, but that is a thin margin in front of the cloud metadata
 * endpoint, so internal targets are refused outright.
 */
describe('checkHost', () => {
  it('refuses the cloud metadata endpoint', async () => {
    const v = await checkHost('169.254.169.254')
    expect(v.allowed).toBe(false)
    expect(v.reason).toContain('inside this network')
  })

  it('refuses every RFC1918 range', async () => {
    for (const ip of ['10.0.0.5', '172.16.4.2', '172.31.255.1', '192.168.1.1', '100.64.0.1'])
      expect((await checkHost(ip)).allowed, ip).toBe(false)
  })

  it('allows a genuinely public address', async () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '172.15.0.1'])
      expect((await checkHost(ip)).allowed, ip).toBe(true)
  })

  it('refuses loopback unless the caller opts in', async () => {
    expect((await checkHost('127.0.0.1')).allowed).toBe(false)
    // SMTP opts in: the shipped compose stack runs Mailpit on localhost.
    expect((await checkHost('127.0.0.1', { allowLoopback: true })).allowed).toBe(true)
    expect((await checkHost('::1', { allowLoopback: true })).allowed).toBe(true)
  })

  it('refuses internal IPv6, including v4-mapped forms', async () => {
    for (const ip of ['fe80::1', 'fd00::1', 'fc00::1', 'ff02::1', '::ffff:10.0.0.1'])
      expect((await checkHost(ip)).allowed, ip).toBe(false)
  })

  it('refuses a name that does not resolve rather than letting it through', async () => {
    const v = await checkHost('nx.invalid.test.example')
    expect(v.allowed).toBe(false)
    expect(v.reason).toContain('does not resolve')
  })

  it('refuses an empty host', async () => {
    expect((await checkHost('   ')).allowed).toBe(false)
  })
})

describe('isLoopback', () => {
  it('covers the whole 127/8 range, not just 127.0.0.1', () => {
    // 127.0.0.2 and friends reach the same machine; a check that only knows 127.0.0.1 is
    // trivially bypassed.
    expect(isLoopback('127.0.0.1')).toBe(true)
    expect(isLoopback('127.9.9.9')).toBe(true)
    expect(isLoopback('::1')).toBe(true)
    expect(isLoopback('8.8.8.8')).toBe(false)
  })
})
