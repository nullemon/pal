import type { NextRequest } from 'next/server'

/**
 * Next 16 proxy (formerly middleware.ts). Shared file — Phase 1 agents append (P6 adds the
 * redirects / slug-history 301s here); keep the matcher list explicit so `/` and the ISR
 * pages stay untouched.
 *
 * Storage host: a path with malformed percent-encoding (`/_storage/%E0%A4%A`) makes Next's
 * router throw a DecodeError before any route handler runs, and the App Router has no /400
 * page, so it surfaced as a bare 500. Answer with the handler's own `{ error }` 404 instead.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  try {
    decodeURIComponent(pathname)
  } catch {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  return undefined
}

export const config = {
  matcher: ['/_storage/:path*', '/api/storage/:path*'],
}
