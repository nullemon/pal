import { createHmac, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { getEnv } from '@/lib/env'

/**
 * The anonymous visitor id — the only handle this site keeps on a reader who is not signed
 * in, and deliberately the least informative one that still works.
 *
 * It is a random number the browser carries and nothing else: not derived from an address,
 * a user agent, a screen or anything else about the person or the device, so it says nothing
 * about where they are and cannot be recomputed from a packet capture or a server log. The
 * reader clears it with their cookies; a new one is minted and the old rows simply age out.
 *
 * It replaces the client address in the two places that used to key on one:
 *
 *   * `view_events.viewer_key` — "one view per reader per chapter per day"
 *   * `series_request_votes.voter_key` — "one vote per reader per request"
 *
 * Both of those were an HMAC of the address, which reads as private and is not: IPv4 is 2^32
 * wide, so anyone holding the app secret can hash the whole space once and turn every stored
 * key back into an address. There is no such space to sweep for a 128-bit random value.
 *
 * **What is stored is never the id itself** but an HMAC of it under the app secret. A
 * database dump therefore does not hand anyone a cookie value they could set in their own
 * browser to impersonate a reader's votes.
 */

/**
 * First-party, HttpOnly, no third party ever sees it. The name is historical — this started
 * as the request board's ballot cookie — and is kept so that ballots already in readers'
 * browsers keep resolving to the same votes instead of silently resetting on deploy.
 */
export const VISITOR_COOKIE = 'ps_rq_ballot'
/** The cap Chrome puts on cookie lifetime; anything longer is silently truncated anyway. */
export const VISITOR_MAX_AGE = 400 * 24 * 3600
/** Bytes of HMAC kept. 16 is plenty against collisions and half the storage. */
export const VISITOR_KEY_BYTES = 16

/**
 * `HMAC(secret, scope | identity)` truncated — the form that actually reaches a column.
 *
 * `scope` keeps the derivations of one id apart, so the key a reader's views are stored
 * under is not the key their votes are stored under and the two tables cannot be joined on
 * it. Each scope carries a version (`pv:v1`) so the scheme can change later without old and
 * new keys silently merging.
 */
export const visitorKeyFor = (scope: string, identity: string, secret: string): Uint8Array =>
  new Uint8Array(
    createHmac('sha256', secret)
      .update(`${scope}|${identity}`)
      .digest()
      .subarray(0, VISITOR_KEY_BYTES),
  )

/** The id this browser is already carrying, or null. Safe in a server component. */
export const readVisitorId = async (): Promise<string | null> =>
  (await cookies()).get(VISITOR_COOKIE)?.value || null

/**
 * The same, minting one when the browser has none. Route handlers and server actions only —
 * `cookies().set` throws in a server component, which is why reads have their own helper.
 *
 * The new id is returned and used on this very request rather than being banked for the
 * next one, so a reader's first view or first vote counts like every other.
 */
export const ensureVisitorId = async (): Promise<string> => {
  const jar = await cookies()
  const existing = jar.get(VISITOR_COOKIE)?.value
  if (existing) return existing
  const minted = randomBytes(16).toString('hex')
  jar.set(VISITOR_COOKIE, minted, {
    httpOnly: true,
    sameSite: 'lax',
    secure: getEnv().SITE_URL.startsWith('https://'),
    path: '/',
    maxAge: VISITOR_MAX_AGE,
  })
  return minted
}
