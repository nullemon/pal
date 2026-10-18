import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { publicCache } from '../../proxy'

/**
 * Which responses a shared cache may hold.
 *
 * This is the paywall's blast radius, so the rule is asserted rather than trusted to a
 * reading of the handler: a request carrying a session must never produce a cacheable
 * response, because an edge copy would be served to the next reader along.
 *
 * It is safe to cache the signed-out render precisely because it is not personalised — a
 * signed-out reader is shown locked chapters locked, since `canReadChapter` was given a null
 * user — and because a page render cannot set a cookie, so no cached copy carries one
 * browser's identity to another.
 */

const ctx = (pathname: string) => ({ pathname, headers: new Headers() })

const call = (pathname: string, opts: { signedIn?: boolean; method?: string } = {}) => {
  const request = new NextRequest(`https://palscans.org${pathname}`, {
    method: opts.method ?? 'GET',
  })
  if (opts.signedIn) request.cookies.set('sid', 'a-session-token')
  const c = ctx(pathname)
  publicCache(request, c)
  return c.headers.get('cache-control')
}

describe('publicCache', () => {
  it('lets a shared cache hold a signed-out series page', () => {
    expect(call('/series/one-piece')).toContain('s-maxage')
  })

  it('lets a shared cache hold a signed-out chapter page', () => {
    expect(call('/series/one-piece/chapter-1196')).toContain('s-maxage')
  })

  it('refuses to cache anything for a reader with a session', () => {
    // The whole safety argument: an edge copy of a signed-in render is served to whoever
    // asks next, which for a paywalled chapter would be the paywall gone.
    expect(call('/series/one-piece', { signedIn: true })).toBe('private, no-store')
    expect(call('/series/one-piece/chapter-1196', { signedIn: true })).toBe('private, no-store')
  })

  it('leaves pages outside the list alone', () => {
    // Account pages, the panel, anything that might key on the visitor cookie.
    for (const path of ['/me/history', '/me/bookmarks', '/admin/chapters', '/login', '/subscribe'])
      expect(call(path), path).toBeNull()
  })

  it('does not cache a non-GET request', () => {
    expect(call('/series/one-piece', { method: 'POST' })).toBeNull()
  })

  it('caches the discovery surfaces, which are the same for every signed-out reader', () => {
    expect(call('/browse')).toContain('s-maxage')
    expect(call('/genres/action')).toContain('s-maxage')
  })

  it('does not match a path that merely starts like a series page', () => {
    // `/series/one-piece/feed` is a different handler with its own caching.
    expect(call('/series/one-piece/feed')).toBeNull()
    expect(call('/series')).toBeNull()
  })

  it('keeps the window short, so a release appears quickly', () => {
    const header = call('/series/one-piece') ?? ''
    const seconds = Number(/s-maxage=(\d+)/.exec(header)?.[1])
    expect(seconds).toBeGreaterThan(0)
    expect(seconds).toBeLessThanOrEqual(300)
  })

  it('never sets Vary: Cookie, which would cache nothing at all', () => {
    // The visitor cookie is unique per browser, so varying on it gives every reader their
    // own entry. Keeping signed-in readers off the cached copy is the edge's job.
    const c = ctx('/series/one-piece')
    publicCache(new NextRequest('https://palscans.org/series/one-piece'), c)
    expect(c.headers.get('vary')).toBeNull()
  })
})
