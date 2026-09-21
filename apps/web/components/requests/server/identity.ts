import { getSessionUser } from '@/lib/auth/session'
import { getEnv } from '@/lib/env'
import { ensureVisitorId, readVisitorId, visitorKeyFor } from '@/lib/visitor'

/**
 * Who is voting, and how sure we are.
 *
 * The request board's whole value rests on "one person, one vote", so it needs an identity
 * for readers who are not signed in. That identity is the anonymous visitor id
 * (`lib/visitor.ts`): a random number the browser carries, stored only as an HMAC of itself.
 *
 * It used to be the client address, with the cookie as a fallback for deployments that could
 * not see one. That was stricter — one vote per address rather than per browser — and it
 * also meant the votes table held a reversible record of every anonymous voter's address
 * (IPv4 is 2^32 wide; the app secret plus a few minutes of hashing turns every `voter_key`
 * back into an IP). One vote per browser is the weaker guarantee and the one that does not
 * come with a location record attached.
 *
 * The precedence is account → visitor cookie. A signed-in reader is keyed by account, so
 * clearing cookies does not hand them a second vote.
 */

/**
 * `voter_key` = HMAC(secret, 'rq:v1|' + identity), truncated. Unchanged in shape from when
 * the identity was an address, so keys already stored for signed-in readers still match.
 */
export const voterKeyFor = (identity: string, secret: string): Uint8Array =>
  visitorKeyFor('rq:v1', identity, secret)

export type IdentitySource = 'account' | 'visitor' | 'none'

export interface RequestActor {
  userId: number | null
  /** null when nothing identifies this reader — voting is refused rather than pooled. */
  voterKey: Uint8Array | null
  source: IdentitySource
  /**
   * The rate-limit bucket component — a Redis counter with a TTL, never a stored row.
   */
  limitKey: string | null
}

const identityOf = (
  userId: number | null,
  visitor: string | null,
): { identity: string; source: IdentitySource } | null => {
  if (userId) return { identity: `u:${userId}`, source: 'account' }
  if (visitor) return { identity: `c:${visitor}`, source: 'visitor' }
  return null
}

const build = (userId: number | null, visitor: string | null, secret: string): RequestActor => {
  const id = identityOf(userId, visitor)
  return {
    userId,
    voterKey: id ? voterKeyFor(id.identity, secret) : null,
    source: id?.source ?? 'none',
    limitKey: userId ? `u:${userId}` : visitor ? `c:${visitor.slice(0, 32)}` : null,
  }
}

/**
 * The actor for a read (a page render, a suggest query). Never mints an id: a server
 * component cannot set a cookie, and a reader who has never voted does not need one.
 */
export const readActor = async (): Promise<RequestActor> => {
  const [user, visitor] = await Promise.all([getSessionUser().catch(() => null), readVisitorId()])
  return build(user?.id ?? null, visitor, getEnv().SESSION_SECRET)
}

/**
 * The actor for a write, minting the visitor id when the browser has none. Route handlers
 * only — `cookies().set` throws in a server component.
 */
export const writeActor = async (): Promise<RequestActor> => {
  const user = await getSessionUser().catch(() => null)
  // A signed-in reader is keyed by account and needs no cookie, so do not mint one for them.
  const visitor = user?.id ? await readVisitorId() : await ensureVisitorId()
  return build(user?.id ?? null, visitor, getEnv().SESSION_SECRET)
}
