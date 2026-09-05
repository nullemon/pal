import { describe, expect, it } from 'vitest'
import { csp, cspDirective, type PolicyName, securityHeaders } from './csp'

const POLICIES: PolicyName[] = ['site', 'panel']
const parse = (name: PolicyName): Map<string, string[]> =>
  new Map(
    csp(name)
      .split('; ')
      .map((d) => {
        const [directive, ...values] = d.split(' ')
        return [directive as string, values]
      }),
  )

/**
 * The policy is a security control that is easy to weaken by accident and easy to tighten
 * into something that breaks a feature silently. Both directions are asserted here.
 */
describe('every policy', () => {
  it('carries the four directives that work without a nonce', () => {
    for (const name of POLICIES) {
      const p = parse(name)
      expect(p.get('object-src'), name).toEqual(["'none'"])
      expect(p.get('base-uri'), name).toEqual(["'self'"])
      expect(p.get('form-action'), name).toEqual(["'self'"])
      expect(p.get('frame-ancestors'), name).toEqual(["'self'"])
      expect(p.get('default-src'), name).toEqual(["'self'"])
    }
  })

  it('never allows plain http, a wildcard, or eval', () => {
    for (const name of POLICIES) {
      const value = csp(name)
      expect(value, name).not.toMatch(/\bhttp:/)
      expect(value, name).not.toMatch(/'unsafe-eval'/)
      // A bare `*` would make `default-src 'self'` decorative.
      expect(value.split(/[ ;]/), name).not.toContain('*')
    }
  })

  it('says something about every fetch directive rather than leaning on default-src', () => {
    // `default-src` does not cover `form-action`, `base-uri` or `frame-ancestors` at all,
    // and a missing `connect-src` is the one people notice last.
    for (const name of POLICIES) {
      const p = parse(name)
      for (const directive of ['script-src', 'style-src', 'img-src', 'connect-src', 'frame-src'])
        expect(p.has(directive), `${name} is missing ${directive}`).toBe(true)
    }
  })
})

describe('the admin panel policy', () => {
  it('admits no third-party script and no frames at all', () => {
    // The panel renders no operator-authored code — `components/shell/CustomCode.tsx` is
    // mounted by the public site layout only — so there is nothing legitimate to load from
    // another origin. This is the browser-enforced half of that scoping argument.
    expect(cspDirective('panel', 'script-src')).toEqual(["'self'", "'unsafe-inline'"])
    expect(cspDirective('panel', 'frame-src')).toEqual(["'none'"])
    expect(cspDirective('panel', 'font-src')).not.toContain('https:')
  })
})

describe('the public site policy', () => {
  it('still lets an operator snippet and an ad tag run', () => {
    // docs/15 "Advanced" ships operator `<script>` and docs/11 ships ad tags, which are
    // arbitrary third-party script by definition. Tightening this to a host list breaks them
    // the first time a tag loads a second script from an unlisted host — so if this ever
    // changes, `adminMessages.advancedScreen.cspYes` has to change with it.
    expect(cspDirective('site', 'script-src')).toContain('https:')
    expect(cspDirective('site', 'script-src')).toContain("'unsafe-inline'")
    expect(cspDirective('site', 'frame-src')).toContain('https:')
  })

  it('keeps the reader-facing sources the site actually uses', () => {
    // The CDN host is operator-configurable at runtime, so it cannot be pinned in a
    // build-time header; `data:` is the TOTP QR code, `blob:` the offline downloads.
    for (const source of ['data:', 'blob:', 'https:'])
      expect(cspDirective('site', 'img-src'), source).toContain(source)
  })
})

describe('the header routing', () => {
  const entries = securityHeaders()
  const valueFor = (source: string) => entries.find((e) => e.source === source)?.headers[0]?.value

  it('sends exactly one Content-Security-Policy per entry', () => {
    for (const entry of entries) {
      expect(entry.headers).toHaveLength(1)
      expect(entry.headers[0]?.key).toBe('Content-Security-Policy')
    }
  })

  it('gives the panel routes the panel policy and the root the site policy', () => {
    expect(valueFor('/admin')).toBe(csp('panel'))
    expect(valueFor('/admin/:path*')).toBe(csp('panel'))
    expect(valueFor('/api/admin/:path*')).toBe(csp('panel'))
    expect(valueFor('/')).toBe(csp('site'))
  })

  it('excludes the panel and the non-HTML trees from the catch-all', () => {
    // Two matching entries would both be applied and the browser would enforce their
    // intersection — a policy nobody wrote down. The lookahead is what keeps them disjoint.
    const catchAll = entries.find((e) => e.source.includes('(?!'))
    expect(catchAll?.headers[0]?.value).toBe(csp('site'))
    for (const excluded of ['admin$', 'admin/', 'api/', '_next/', '_storage/'])
      expect(catchAll?.source, excluded).toContain(excluded)
  })
})
