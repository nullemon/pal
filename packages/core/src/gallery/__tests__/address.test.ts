import { describe, expect, it } from 'vitest'
import { directUrlProblem, isBlockedAddress, isBlockedHostname } from '../address.js'

/**
 * The guard that replaces the host allowlist for operator-supplied URLs.
 *
 * ImgChest and Imgur need none of this — one host each. A direct URL list has no allowlist
 * by design, so this is the only thing standing between "paste your page URLs" and a
 * server-side request forgery that reads Postgres on loopback and returns it as a page.
 */

describe('isBlockedAddress', () => {
  it('blocks loopback, private, link-local and metadata addresses', () => {
    for (const addr of [
      '127.0.0.1',
      '127.1.2.3',
      '0.0.0.0',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // the cloud metadata address
      '100.64.0.1', // carrier NAT
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
    ])
      expect(isBlockedAddress(addr), addr).toBe(true)
  })

  it('allows ordinary public addresses', () => {
    for (const addr of ['1.1.1.1', '8.8.8.8', '46.32.185.191', '172.32.0.1', '192.167.1.1'])
      expect(isBlockedAddress(addr), addr).toBe(false)
  })

  it('blocks IPv6 loopback, unique-local and link-local', () => {
    for (const addr of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '[::1]'])
      expect(isBlockedAddress(addr), addr).toBe(true)
  })

  it('sees through an IPv4-mapped IPv6 address', () => {
    // ::ffff:127.0.0.1 reaches loopback. Judging it as "some IPv6 address" is the bypass.
    for (const addr of ['::ffff:127.0.0.1', '::ffff:169.254.169.254', '::127.0.0.1'])
      expect(isBlockedAddress(addr), addr).toBe(true)
  })

  it('allows a public IPv6 address', () => {
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false)
  })
})

describe('isBlockedHostname', () => {
  it('blocks local and internal names', () => {
    for (const host of [
      'localhost',
      'foo.localhost',
      'db.local',
      'thing.internal',
      'metadata.google.internal',
      'metadata',
      'router.home.arpa',
      'svc.cluster.local',
    ])
      expect(isBlockedHostname(host), host).toBe(true)
  })

  it('blocks a bare name with no dot, which is always a local lookup', () => {
    expect(isBlockedHostname('postgres')).toBe(true)
    expect(isBlockedHostname('valkey')).toBe(true)
  })

  it('allows real image hosts', () => {
    for (const host of ['cdn.imgchest.com', 'i.imgur.com', 'images.example.co.uk'])
      expect(isBlockedHostname(host), host).toBe(false)
  })
})

describe('directUrlProblem', () => {
  it('accepts an ordinary image URL', () => {
    expect(directUrlProblem('https://cdn.example.com/a/01.jpg')).toBeNull()
    expect(directUrlProblem('http://cdn.example.com:80/01.jpg')).toBeNull()
  })

  it('refuses a non-standard port', () => {
    // Otherwise this is a port scanner that reports its findings as chapter pages.
    expect(directUrlProblem('http://example.com:6379/')).toBe('port')
    expect(directUrlProblem('http://example.com:5432/')).toBe('port')
  })

  it('refuses non-http schemes', () => {
    for (const url of ['file:///etc/passwd', 'gopher://x/', 'data:image/png;base64,AAA'])
      expect(directUrlProblem(url), url).toBe('scheme')
  })

  it('refuses private and loopback hosts', () => {
    for (const url of [
      'http://127.0.0.1/x.jpg',
      'http://localhost/x.jpg',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/x.jpg',
      'http://[::1]/x.jpg',
    ])
      expect(directUrlProblem(url), url).toBe('host')
  })

  it('refuses something that is not a URL at all', () => {
    expect(directUrlProblem('not a url')).toBe('unparseable')
  })
})
