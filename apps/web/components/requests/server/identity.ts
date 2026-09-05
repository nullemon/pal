import { createHmac, randomBytes } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { clientIp, ipKey } from '@/lib/auth'
import { getSessionUser } from '@/lib/auth/session'
import { getEnv } from '@/lib/env'

/**
 * Who is voting, and how sure we are.
 *
 * The request board's whole value rests on "one person, one vote", so it needs an identity
 * for readers who are not signed in. The pattern already in this codebase is the view
 * pipeline's `viewer_key` (packages/core/src/views.ts): an HMAC of the identity under the
 * app secret, truncated, with the raw address never reaching the database. This is that,
 * with one deliberate difference and one deliberate addition.
 *
 * **No day bucket.** `viewerKey` folds the UTC day into the HMAC so a key is only linkable
 * within one day — which is right for a statistic that resets daily, and wrong here: a key
 * that rotated would hand every anonymous reader a fresh vote every morning. `voterKey` is
 * stable for as long as the identity is.
 *
 * **Address, not address + user agent.** `viewerKey` mixes in the user agent, which is fine
 * for de-duplicating views and useless as an anti-abuse measure: changing the UA string is
 * one line in devtools. Keying on the address alone means one vote per address — stricter,
 * at the cost of collapsing a household or a campus to a single vote. For "what should we
 * add next", under-counting a shared address is a better failure than counting one person
 * ten times.
 *
 * The precedence is account → address → ballot cookie, and it matters that the cookie is
 * last: a client-supplied value can never displace an identity the server derived. The
 * cookie only exists so a deployment that cannot see client addresses (`TRUSTED_PROXY=none`)
 * still has *something* to key on rather than silently letting everyone vote forever.
 */

/** First-party, HttpOnly ballot id — the fallback identity when no address is available. */
export const BALLOT_COOKIE = 'ps_rq_ballot'
export const BALLOT_MAX_AGE = 400 * 24 * 3600 // the cap Chrome puts on cookie lifetime
/** Bytes of HMAC kept. 16 is plenty against collisions and half the storage. */
export const VOTER_KEY_BYTES = 16

/**
 * `voter_key` = HMAC(secret, 'rq:v1|' + identity), truncated. The `v1` is there so the
 * scheme can be changed later without silently merging old keys with new ones.
 */
export const voterKeyFor = (identity: string, secret: string): Uint8Array =>
  new Uint8Array(
    createHmac('sha256', secret).update(`rq:v1|${identity}`).digest().subarray(0, VOTER_KEY_BYTES),
  )

export type IdentitySource = 'account' | 'address' | 'ballot' | 'none'

export interface RequestActor {
  userId: number | null
  /** null when nothing identifies this reader — voting is refused rather than pooled. */
  voterKey: Uint8Array | null
  source: IdentitySource
  /**
   * The rate-limit bucket component. Daily-rotating (`ipKey`), unlike `voterKey`: limits are
   * short-lived counters in Redis and there is no reason for them to be linkable for longer.
   */
  limitKey: string | null
  ip: string | null
}

const identityOf = (
  userId: number | null,
  ip: string | null,
  ballot: string | null,
): { identity: string; source: IdentitySource } | null => {
  if (userId) return { identity: `u:${userId}`, source: 'account' }
  if (ip) return { identity: `a:${ip}`, source: 'address' }
  if (ballot) return { identity: `c:${ballot}`, source: 'ballot' }
  return null
}

const build = (
  userId: number | null,
  ip: string | null,
  ballot: string | null,
  secret: string,
): RequestActor => {
  const id = identityOf(userId, ip, ballot)
  return {
    userId,
    voterKey: id ? voterKeyFor(id.identity, secret) : null,
    source: id?.source ?? 'none',
    limitKey: ipKey(ip) ?? (ballot ? `b:${ballot.slice(0, 32)}` : null),
    ip,
  }
}

/**
 * The actor for a read (a page render, a suggest query). Never mints a ballot: a server
 * component cannot set a cookie, and a reader who has never voted does not need one.
 */
export const readActor = async (): Promise<RequestActor> => {
  const [user, head, jar] = await Promise.all([
    getSessionUser().catch(() => null),
    headers(),
    cookies(),
  ])
  return build(
    user?.id ?? null,
    clientIp(head),
    jar.get(BALLOT_COOKIE)?.value ?? null,
    getEnv().SESSION_SECRET,
  )
}

/**
 * The actor for a write, minting the ballot cookie if that is the only identity available.
 * Route handlers only — `cookies().set` throws in a server component.
 */
export const writeActor = async (): Promise<RequestActor> => {
  const [user, head, jar] = await Promise.all([
    getSessionUser().catch(() => null),
    headers(),
    cookies(),
  ])
  const ip = clientIp(head)
  let ballot = jar.get(BALLOT_COOKIE)?.value ?? null
  if (!user?.id && !ip && !ballot) {
    ballot = randomBytes(16).toString('hex')
    jar.set(BALLOT_COOKIE, ballot, {
      httpOnly: true,
      sameSite: 'lax',
      secure: getEnv().SITE_URL.startsWith('https://'),
      path: '/',
      maxAge: BALLOT_MAX_AGE,
    })
  }
  return build(user?.id ?? null, ip, ballot, getEnv().SESSION_SECRET)
}
