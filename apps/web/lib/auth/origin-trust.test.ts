import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clientIp } from './rate-limit'

/**
 * The pre-launch audit's highest finding: with `TRUSTED_PROXY=cloudflare` the app reads the
 * client address off `CF-Connecting-IP`, which is a header, which anyone who can reach the
 * origin directly can type. It was used to walk through the panel's IP allowlist and to
 * collapse every per-IP rate limit on the site.
 *
 * Most of the fix is the operator's (docs/18 §3 "Lock the origin down"), but the half that
 * lives in this repository is `infra/Caddyfile` deleting those headers from any peer outside
 * Cloudflare's ranges — measured against Caddy 2.10.2 — and it is asserted here rather than
 * only described, because it is one deleted line away from being gone again.
 */
const CADDYFILE = readFileSync(join(import.meta.dirname, '../../../../infra/Caddyfile'), 'utf8')
/** The file with its comments removed: a directive inside a `#` line is not a directive. */
const live = CADDYFILE.split('\n')
  .filter((l) => !l.trim().startsWith('#'))
  .join('\n')

describe('the origin cannot be told who the client is', () => {
  it('matches non-Cloudflare peers on the socket address, not on a header', () => {
    // `remote_ip` is the peer Caddy is talking to. A header-based matcher here would be
    // circular: the thing being verified deciding whether to verify itself.
    expect(live).toMatch(/@direct\s+not\s+remote_ip\s+\d/)
  })

  it('deletes every CF-* header the app reads from those peers', () => {
    // `cf-connecting-ip` is the client address (lib/auth/rate-limit.ts) and `cf-ipcountry` /
    // `cf-ipcity` are the geo columns on login_events (lib/auth/login-events.ts). Forging the
    // last two only poisons an audit trail, which is still worth not allowing.
    for (const header of ['CF-Connecting-IP', 'CF-IPCountry', 'CF-IPCity', 'True-Client-IP'])
      expect(live, header).toContain(`header_up -${header}`)
  })

  it('keeps them for peers that really are Cloudflare', () => {
    // The `@direct` branch strips; the unmatched fallback must not, or `TRUSTED_PROXY=
    // cloudflare` would never see a client address in production at all.
    const direct = live.indexOf('handle @direct')
    const fallback = live.indexOf('handle {', direct)
    expect(direct, 'the @direct handle block').toBeGreaterThan(-1)
    expect(fallback, 'a fallback handle for Cloudflare peers').toBeGreaterThan(direct)
    expect(live.slice(fallback)).not.toMatch(/header_up\s+-CF-/)
  })

  it('lists Cloudflare ranges with the command that refreshes them', () => {
    expect(live).toContain('104.16.0.0/13') // v4
    expect(live).toContain('2606:4700::/32') // v6
    expect(CADDYFILE).toContain('https://www.cloudflare.com/ips-v4')
  })

  it('ships the full lockdown commented out, so `xff` deployments still work', () => {
    // Uncommenting `abort @direct` refuses non-Cloudflare peers outright. It cannot be the
    // default: with Caddy alone in front (TRUSTED_PROXY=xff) it would refuse every visitor.
    expect(CADDYFILE).toContain('# abort @direct')
    expect(live).not.toMatch(/^\s*abort\s+@direct\s*$/m)
  })
})

describe('what the app does once the headers are gone', () => {
  const req = (h: Record<string, string>) => new Request('http://x/', { headers: h })

  it('falls back to the address Caddy saw, so the forger rate-limits themselves', () => {
    // Caddy replaces an inbound X-Forwarded-For with the peer when no `trusted_proxies` is
    // declared, so this is the attacker's real address — not one they chose.
    expect(
      clientIp(req({ 'x-forwarded-for': '203.0.113.9' }), { mode: 'cloudflare', hops: 1 }),
    ).toBe('203.0.113.9')
  })

  it('leaves TRUSTED_PROXY=xff completely alone', () => {
    // The audit confirmed `xff` was never affected; the Caddyfile change must not change
    // that either. `xff` never consults a CF-* header, present or absent.
    const withCf = { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '1.2.3.4' }
    expect(clientIp(req(withCf), { mode: 'xff', hops: 1 })).toBe('203.0.113.9')
    const { 'cf-connecting-ip': _dropped, ...withoutCf } = withCf
    expect(clientIp(req(withoutCf), { mode: 'xff', hops: 1 })).toBe('203.0.113.9')
  })
})
