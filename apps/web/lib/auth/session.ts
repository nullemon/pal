import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { EntitlementRow, SessionUser } from '@palscans/core'
import { entitlements, getDb, sessions, users } from '@palscans/db'
import { and, eq, gt, isNull, or } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { cache } from 'react'
import { z } from 'zod'
import { getEnv } from '../env'
import { activeUserBan } from './bans'
import { getRedis } from './redis'

/**
 * Opaque sessions (docs/07): cookie `sid=<session-uuid>.<base64url secret>`; the row stores
 * `sha256(secret)`. Lookup is Redis-first (`sess:<id>` → {userId, hash, expiry}) with the
 * database on a miss; revocation deletes both. Secrets rotate on privilege change (login,
 * password change, TOTP change) via `rotateSession`.
 */
export const SESSION_COOKIE = 'sid'
export const SESSION_TTL_SEC = 30 * 24 * 3600
/** Refresh `sessions.last_seen_at` at most this often. */
export const LAST_SEEN_INTERVAL_MS = 5 * 60_000
const CACHE_PREFIX = 'sess:'

const cookieSchema = z
  .string()
  .regex(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{32,128}$/)
  .transform((raw) => {
    const dot = raw.indexOf('.')
    return { id: raw.slice(0, dot), secret: raw.slice(dot + 1) }
  })
  .pipe(z.object({ id: z.uuid(), secret: z.string() }))

export interface ParsedSessionCookie {
  id: string
  secret: string
}

/** Split and validate the cookie value; null for anything malformed. */
export function parseSessionCookie(raw: string | undefined): ParsedSessionCookie | null {
  if (!raw) return null
  const result = cookieSchema.safeParse(raw)
  return result.success ? result.data : null
}

/** The stored hash of a session secret: sha256 over the cookie's secret string. */
export function hashSessionSecret(secret: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(secret, 'utf8').digest())
}

const WEEK_MS = 7 * 24 * 3600 * 1000

/** The rotating salt for persisted IP hashes: the UTC week the row was written in. */
export const ipHashSalt = (at: Date = new Date()): string =>
  `w${Math.floor(at.getTime() / WEEK_MS)}`

/**
 * Client IPs are persisted hashed (sessions, comments, audit log — abuse detection, never
 * logging): HMAC with the app secret over a weekly salt and the address, so a database dump
 * plus the secret only lets an attacker sweep one week's worth of rows at a time, and rows
 * from different weeks never share a hash. Comparisons are meaningful within a week.
 */
export function hashIp(
  ip: string | null | undefined,
  at: Date = new Date(),
  secret: string = getEnv().SESSION_SECRET,
): Uint8Array | null {
  if (!ip) return null
  return new Uint8Array(
    createHmac('sha256', secret)
      .update(`${ipHashSalt(at)}:${ip}`, 'utf8')
      .digest(),
  )
}

const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

interface CachedSession {
  u: number
  h: string
  e: number
  s: number | null
}

const cachedSchema = z.object({
  u: z.number().int(),
  h: z.string().regex(/^[0-9a-f]{64}$/),
  e: z.number().int(),
  s: z.number().int().nullable(),
})

const cacheKey = (id: string) => `${CACHE_PREFIX}${id}`

const readCache = async (id: string): Promise<CachedSession | null> => {
  const redis = await getRedis()
  if (!redis) return null
  try {
    const raw = await redis.get(cacheKey(id))
    if (!raw) return null
    const parsed = cachedSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const writeCache = async (id: string, record: CachedSession): Promise<void> => {
  const redis = await getRedis()
  if (!redis) return
  const ttl = Math.min(record.e - Date.now(), 24 * 3600 * 1000)
  if (ttl <= 0) return
  try {
    await redis.set(cacheKey(id), JSON.stringify(record), 'PX', ttl)
  } catch {
    // cache is best-effort
  }
}

const dropCache = async (ids: string[]): Promise<void> => {
  if (ids.length === 0) return
  const redis = await getRedis()
  if (!redis) return
  try {
    await redis.del(...ids.map(cacheKey))
  } catch {
    // best-effort
  }
}

/** Session record (id → user + hash), Redis first, then the table. */
const loadSession = async (id: string): Promise<CachedSession | null> => {
  const cached = await readCache(id)
  if (cached) return cached
  const db = await getDb()
  const [row] = await db
    .select({
      userId: sessions.userId,
      secretHash: sessions.secretHash,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
    })
    .from(sessions)
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1)
  if (!row) return null
  const record: CachedSession = {
    u: row.userId,
    h: toHex(row.secretHash),
    e: row.expiresAt.getTime(),
    s: row.lastSeenAt?.getTime() ?? null,
  }
  await writeCache(id, record)
  return record
}

export const loadEntitlements = async (userId: number): Promise<EntitlementRow[]> => {
  const db = await getDb()
  const now = new Date()
  const active = await db
    .select({ feature: entitlements.feature, expiresAt: entitlements.expiresAt })
    .from(entitlements)
    .where(
      and(
        eq(entitlements.userId, userId),
        or(isNull(entitlements.expiresAt), gt(entitlements.expiresAt, now)),
      ),
    )
  return active.map((e) => ({ feature: e.feature, expires_at: e.expiresAt }))
}

/**
 * The `SessionUser` for a user id (null when deleted or account-banned — a ban therefore
 * ends every session immediately, cached or not). Exported for the OAuth + MFA flows.
 */
export const loadSessionUser = async (userId: number): Promise<SessionUser | null> => {
  const db = await getDb()
  const [row] = await db
    .select({
      id: users.id,
      role: users.role,
      username: users.username,
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1)
  if (!row) return null
  if (await activeUserBan(row.id)) return null
  return { ...row, entitlements: await loadEntitlements(row.id) }
}

/** Resolve a cookie value to its user; null for anything invalid, expired or revoked. */
export const resolveSession = async (
  raw: string | undefined,
): Promise<{ sessionId: string; user: SessionUser } | null> => {
  const parsed = parseSessionCookie(raw)
  if (!parsed) return null
  const record = await loadSession(parsed.id)
  if (!record) return null
  const expected = hashSessionSecret(parsed.secret)
  const stored = Buffer.from(record.h, 'hex')
  if (stored.byteLength !== expected.byteLength || !timingSafeEqual(stored, expected)) return null
  const user = await loadSessionUser(record.u)
  if (!user) return null
  const now = Date.now()
  if (!record.s || now - record.s > LAST_SEEN_INTERVAL_MS) {
    const db = await getDb()
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(now) })
      .where(eq(sessions.id, parsed.id))
    await writeCache(parsed.id, { ...record, s: now })
  }
  return { sessionId: parsed.id, user }
}

/** The request's cookie resolved once (secret verified) and shared by the helpers below. */
const getResolvedSession = cache(async () => {
  const store = await cookies()
  return resolveSession(store.get(SESSION_COOKIE)?.value)
})

/**
 * The signed-in user for this request, or null. Memoised per request with React `cache`.
 * Calling it makes the route dynamic (it reads cookies) — call it only from pages that
 * personalise.
 */
export const getSessionUser = cache(
  async (): Promise<SessionUser | null> => (await getResolvedSession())?.user ?? null,
)
/**
 * The current session id — only when the cookie's secret verified against the row, so a
 * crafted `sid=<someone else's uuid>.<junk>` never names a session to revoke or rotate.
 * Null for anonymous or invalid cookies ("this device" on the security page).
 */
export const getSessionId = cache(
  async (): Promise<string | null> => (await getResolvedSession())?.sessionId ?? null,
)

export interface SessionContext {
  userAgent?: string | null
  ip?: string | null
}

export interface CreatedSession {
  id: string
  cookieValue: string
  expiresAt: Date
}

/** Insert a session row and return the cookie value (the only time the secret exists). */
export const createSession = async (
  userId: number,
  ctx: SessionContext = {},
): Promise<CreatedSession> => {
  const id = randomUUID()
  const secret = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_SEC * 1000)
  const db = await getDb()
  await db.insert(sessions).values({
    id,
    userId,
    secretHash: hashSessionSecret(secret),
    userAgent: ctx.userAgent?.slice(0, 512) ?? null,
    ipHash: hashIp(ctx.ip),
    expiresAt,
    lastSeenAt: new Date(),
  })
  return { id, cookieValue: `${id}.${secret}`, expiresAt }
}

export const revokeSession = async (id: string): Promise<void> => {
  const db = await getDb()
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
  await dropCache([id])
}

/** Revoke every active session of a user, optionally keeping one (the current device). */
export const revokeAllSessions = async (userId: number, exceptId?: string): Promise<number> => {
  const db = await getDb()
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
  const ids = rows.map((r) => r.id).filter((id) => id !== exceptId)
  if (ids.length === 0) return 0
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
  if (exceptId) {
    await db.update(sessions).set({ revokedAt: null }).where(eq(sessions.id, exceptId))
  }
  await dropCache(ids)
  return ids.length
}

/** docs/07: rotate the secret on privilege change — revoke the old row, mint a new one. */
export const rotateSession = async (
  currentId: string | null,
  userId: number,
  ctx: SessionContext = {},
): Promise<CreatedSession> => {
  if (currentId) await revokeSession(currentId)
  return createSession(userId, ctx)
}

export interface ActiveSession {
  id: string
  userAgent: string | null
  createdAt: Date
  lastSeenAt: Date | null
  expiresAt: Date
  current: boolean
}

export const listSessions = async (userId: number, currentId: string | null) => {
  const db = await getDb()
  const rows = await db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
  const list: ActiveSession[] = rows.map((r) => ({ ...r, current: r.id === currentId }))
  return list.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1
    return (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0)
  })
}

/**
 * Whether auth cookies carry `Secure`: always in production (env.ts also refuses a non-https
 * SITE_URL there), and on https origins elsewhere — never decided by the URL alone.
 */
export const secureCookies = (env: { NODE_ENV: string; SITE_URL: string } = getEnv()): boolean =>
  env.NODE_ENV === 'production' || env.SITE_URL.startsWith('https://')

/** Cookie attributes (docs/07): HttpOnly, Secure (https origins), SameSite=Lax, 30 days. */
export const sessionCookieOptions = (expiresAt: Date) => ({
  httpOnly: true,
  secure: secureCookies(),
  sameSite: 'lax' as const,
  path: '/',
  expires: expiresAt,
})

export const setSessionCookie = async (created: CreatedSession): Promise<void> => {
  const store = await cookies()
  store.set(SESSION_COOKIE, created.cookieValue, sessionCookieOptions(created.expiresAt))
}

export const clearSessionCookie = async (): Promise<void> => {
  const store = await cookies()
  store.set(SESSION_COOKIE, '', { ...sessionCookieOptions(new Date(0)), maxAge: 0 })
}

/** Drop a user's cached session records (e.g. after a role change). */
export const invalidateSessionCache = async (userId: number): Promise<void> => {
  const db = await getDb()
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
  await dropCache(rows.map((r) => r.id))
}
