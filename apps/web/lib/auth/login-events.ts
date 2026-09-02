import { getDb, loginEvents, sessions } from '@palscans/db'
import { and, count, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import { clientIp } from './rate-limit'
import { hashIp } from './session'

/**
 * docs/17 §C — login history. Every authentication attempt writes one `login_events` row:
 * who (null when the address matches no account), how, how it ended, the user agent and what
 * it parses to, the country/city Cloudflare put on the request, and the hashed address. The
 * raw IP is never stored — `hashIp` is the same weekly-salted HMAC the sessions and comments
 * use, so rows are comparable within a week and useless outside it.
 */

export const LOGIN_METHODS = ['password', 'google', 'discord', 'totp'] as const
export type LoginMethod = (typeof LOGIN_METHODS)[number]

export const LOGIN_OUTCOMES = [
  'success',
  'bad_password',
  'locked',
  'totp_failed',
  'banned',
] as const
export type LoginOutcome = (typeof LOGIN_OUTCOMES)[number]

export interface ParsedAgent {
  device: 'Desktop' | 'Mobile' | 'Tablet' | 'Bot' | 'Unknown'
  browser: string
  os: string
}

const UNKNOWN_AGENT: ParsedAgent = { device: 'Unknown', browser: 'Unknown', os: 'Unknown' }

const BOT_RE = /bot\b|crawler|spider|slurp|headlesschrome|curl\/|wget\/|python-requests|okhttp/i

/**
 * A user agent reduced to the three things the history table shows. Deliberately small and
 * ordered most-specific first: Edge and Opera both claim "Chrome", Chrome claims "Safari",
 * and every Android tablet claims "Android" without "Mobile".
 */
export const parseUserAgent = (ua: string | null | undefined): ParsedAgent => {
  if (!ua?.trim()) return UNKNOWN_AGENT
  if (BOT_RE.test(ua)) return { device: 'Bot', browser: 'Bot', os: 'Unknown' }

  const browser = /Edg[A-Z]?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser\//.test(ua)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS\//.test(ua)
          ? 'Firefox'
          : /CriOS\//.test(ua)
            ? 'Chrome'
            : /Chrome\//.test(ua)
              ? 'Chrome'
              : /Safari\//.test(ua)
                ? 'Safari'
                : 'Unknown'

  const os = /iPhone|iPod/.test(ua)
    ? 'iOS'
    : /iPad/.test(ua)
      ? 'iPadOS'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows NT/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'macOS'
            : /CrOS/.test(ua)
              ? 'ChromeOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : 'Unknown'

  const device: ParsedAgent['device'] =
    /iPad|Tablet|PlayBook|Silk/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))
      ? 'Tablet'
      : /Mobi|iPhone|iPod|Android|Windows Phone/.test(ua)
        ? 'Mobile'
        : os === 'Unknown' && browser === 'Unknown'
          ? 'Unknown'
          : 'Desktop'

  return { device, browser, os }
}

export interface RequestGeo {
  country: string | null
  city: string | null
}

const CODE_RE = /^[A-Za-z0-9]{2,8}$/

/**
 * Cloudflare puts the visitor's country on `CF-IPCountry` and, on plans that have it, the
 * city on `CF-IPCity`. Both are absent locally and behind other proxies — the columns then
 * stay null and the UI shows a dash rather than guessing.
 */
export const geoFromHeaders = (headers: Headers): RequestGeo => {
  const rawCountry = headers.get('cf-ipcountry')?.trim() ?? ''
  const country =
    rawCountry && rawCountry !== 'XX' && rawCountry !== 'T1' && CODE_RE.test(rawCountry)
      ? rawCountry.toUpperCase()
      : null
  const rawCity = headers.get('cf-ipcity')?.trim() ?? ''
  const city = rawCity ? rawCity.slice(0, 80) : null
  return { country, city }
}

/** "Berlin, DE" / "DE" / null — what the history tables print under "Where". */
export const formatPlace = (geo: RequestGeo): string | null =>
  geo.city && geo.country ? `${geo.city}, ${geo.country}` : (geo.city ?? geo.country)

export interface RecordLoginEventInput {
  request: Request
  userId: number | null
  method: LoginMethod
  outcome: LoginOutcome
  /** The session the attempt created; looked up from the user's newest row when omitted. */
  sessionId?: string | null
}

/**
 * The newest live session of a user — how a successful sign-in finds the row it just wrote
 * (the cookie is set on the response, so the request's own session id is still the old one).
 */
export const latestSessionId = async (userId: number): Promise<string | null> => {
  const db = await getDb()
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .orderBy(desc(sessions.createdAt))
    .limit(1)
  return row?.id ?? null
}

/**
 * Write one attempt. Never throws: an auth response must not depend on the history table,
 * so a failure here is swallowed (the attempt itself already succeeded or failed on its own
 * terms).
 */
export const recordLoginEvent = async (input: RecordLoginEventInput): Promise<void> => {
  try {
    const ua = input.request.headers.get('user-agent')
    const agent = parseUserAgent(ua)
    const geo = geoFromHeaders(input.request.headers)
    const sessionId =
      input.sessionId === undefined && input.outcome === 'success' && input.userId
        ? await latestSessionId(input.userId)
        : (input.sessionId ?? null)
    const db = await getDb()
    await db.insert(loginEvents).values({
      userId: input.userId,
      method: input.method,
      outcome: input.outcome,
      userAgent: ua?.slice(0, 512) ?? null,
      device: agent.device,
      browser: agent.browser,
      os: agent.os,
      country: geo.country,
      city: geo.city,
      ipHash: hashIp(clientIp(input.request)),
      sessionId,
    })
  } catch {
    // history is best-effort; never fail a sign-in because of it
  }
}

export interface LoginEventRow {
  id: number
  at: Date
  method: string
  outcome: string
  device: string | null
  browser: string | null
  os: string | null
  country: string | null
  city: string | null
  sessionId: string | null
}

export const LOGIN_HISTORY_PAGE_SIZE = 10

/** One user's history, newest first, paginated. */
export const listLoginEvents = async (
  userId: number,
  page = 1,
  pageSize = LOGIN_HISTORY_PAGE_SIZE,
): Promise<{ rows: LoginEventRow[]; total: number; pages: number }> => {
  const db = await getDb()
  const where = eq(loginEvents.userId, userId)
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: loginEvents.id,
        at: loginEvents.at,
        method: loginEvents.method,
        outcome: loginEvents.outcome,
        device: loginEvents.device,
        browser: loginEvents.browser,
        os: loginEvents.os,
        country: loginEvents.country,
        city: loginEvents.city,
        sessionId: loginEvents.sessionId,
      })
      .from(loginEvents)
      .where(where)
      .orderBy(desc(loginEvents.at))
      .limit(pageSize)
      .offset((Math.max(1, page) - 1) * pageSize),
    db.select({ n: count() }).from(loginEvents).where(where),
  ])
  const n = total?.n ?? 0
  return { rows, total: n, pages: Math.max(1, Math.ceil(n / pageSize)) }
}

export interface FailedLoginStats {
  lastHour: number
  previousHour: number
  lastDay: number
  /** Distinct accounts that saw a failure in the last hour (null = unknown-email attempts). */
  accounts: number
  /** The last hour is at least three times the one before it, on more than a handful. */
  spike: boolean
}

/**
 * The dashboard tile (docs/17 §C): failed sign-ins in the last hour against the hour before.
 * A "spike" needs both a real jump and a floor, so one failed attempt on a quiet night does
 * not paint the dashboard red.
 */
export const failedLoginStats = async (now: Date = new Date()): Promise<FailedLoginStats> => {
  const db = await getDb()
  const hourAgo = new Date(now.getTime() - 3_600_000)
  const twoHoursAgo = new Date(now.getTime() - 7_200_000)
  const dayAgo = new Date(now.getTime() - 86_400_000)
  const failed = sql`${loginEvents.outcome} <> 'success'`
  const [[recent], [prev], [day]] = await Promise.all([
    db
      .select({ n: count(), accounts: sql<number>`count(distinct ${loginEvents.userId})::int` })
      .from(loginEvents)
      .where(and(failed, gte(loginEvents.at, hourAgo))),
    db
      .select({ n: count() })
      .from(loginEvents)
      .where(and(failed, gte(loginEvents.at, twoHoursAgo), lt(loginEvents.at, hourAgo))),
    db
      .select({ n: count() })
      .from(loginEvents)
      .where(and(failed, gte(loginEvents.at, dayAgo))),
  ])
  const lastHour = recent?.n ?? 0
  const previousHour = prev?.n ?? 0
  return {
    lastHour,
    previousHour,
    lastDay: day?.n ?? 0,
    accounts: Number(recent?.accounts ?? 0),
    spike: isSpike(lastHour, previousHour),
  }
}

/** Pure so the threshold is testable: ≥ 10 failures in the hour and ≥ 3× the hour before. */
export const isSpike = (lastHour: number, previousHour: number): boolean =>
  lastHour >= 10 && lastHour >= Math.max(3, previousHour * 3)
