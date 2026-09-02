import { can, type Permission, type SessionUser } from '@palscans/core'
import { messages } from '@palscans/core/messages'
import { redirect } from 'next/navigation'
import type { z } from 'zod'
import { getEnv } from '../env'
import { getSessionUser } from './session'

/** docs/16: every route handler answers `{ data }` or `{ error }`. */
export const ok = <T>(data: T, init?: ResponseInit): Response => Response.json({ data }, init)

export const fail = (status: number, error: string, message?: string): Response =>
  Response.json({ error, ...(message ? { message } : {}) }, { status })

export const unauthorized = () => fail(401, 'unauthorized', messages.errors.unauthorized)
export const forbidden = () => fail(403, 'forbidden', messages.errors.forbidden)
export const notFound = () => fail(404, 'not_found', messages.errors.notFound)
export const rateLimited = (retryAfterSec: number) =>
  Response.json(
    { error: 'rate_limited', message: messages.auth.tooManyAttempts, retryAfterSec },
    { status: 429, headers: { 'retry-after': String(retryAfterSec) } },
  )

export type ParseResult<T> = { ok: true; data: T } | { ok: false; response: Response }

const firstIssue = (error: z.ZodError) => {
  const first = error.issues[0]
  const where = first?.path.length ? `${first.path.join('.')}: ` : ''
  return `${where}${first?.message ?? messages.errors.validation}`
}

/** Every JSON route body is small; anything past this is refused before it is buffered. */
export const MAX_JSON_BYTES = 64 * 1024

export type BodyResult = { ok: true; body: Uint8Array } | { ok: false; response: Response }

export interface ReadBodyOptions {
  /** Refuse bodies with no (or a non-positive) Content-Length — uploads must declare their size. */
  requireLength?: boolean
}

/**
 * Read a request body with a hard byte cap: Content-Length is checked first, then the
 * stream is consumed chunk by chunk and cancelled the moment the running total passes
 * `max` — the whole body is never buffered before the limit applies.
 */
export const readBody = async (
  request: Request,
  max: number,
  opts: ReadBodyOptions = {},
): Promise<BodyResult> => {
  const tooLarge = () => ({ ok: false as const, response: fail(413, 'too_large') })
  const header = request.headers.get('content-length')
  const declared = header === null || header === '' ? null : Number(header)
  if (declared !== null && (!Number.isFinite(declared) || declared < 0 || declared > max))
    return tooLarge()
  if (opts.requireLength && (declared === null || declared <= 0)) return tooLarge()
  const stream = request.body
  if (!stream) return { ok: true, body: new Uint8Array(0) }
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => undefined)
      return tooLarge()
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    body.set(c, offset)
    offset += c.byteLength
  }
  return { ok: true, body }
}

/** Parse a JSON body (≤ 64 KB) with a zod schema; malformed input is a 400 with the first issue. */
export const parseJson = async <T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<ParseResult<T>> => {
  const read = await readBody(request, MAX_JSON_BYTES)
  if (!read.ok) return read
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(read.body))
  } catch {
    return { ok: false, response: fail(400, 'invalid_json', messages.errors.validation) }
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success)
    return { ok: false, response: fail(400, 'validation', firstIssue(parsed.error)) }
  return { ok: true, data: parsed.data }
}

export const parseQuery = <T>(request: Request, schema: z.ZodType<T>): ParseResult<T> => {
  const raw: Record<string, string> = {}
  new URL(request.url).searchParams.forEach((v, k) => {
    raw[k] = v
  })
  const parsed = schema.safeParse(raw)
  if (!parsed.success)
    return { ok: false, response: fail(400, 'validation', firstIssue(parsed.error)) }
  return { ok: true, data: parsed.data }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * docs/07: SameSite=Lax covers navigations; mutating routes additionally check `Origin`
 * (falling back to `Referer`) against the site origin. Requests without either header
 * (curl, server-to-server) are rejected — send `Origin` from scripts.
 */
export const sameOrigin = (request: Request): boolean => {
  if (!MUTATING.has(request.method.toUpperCase())) return true
  const origin = request.headers.get('origin') ?? request.headers.get('referer')
  if (!origin) return false
  let actual: string
  try {
    actual = new URL(origin).origin
  } catch {
    return false
  }
  const allowed = new Set<string>()
  try {
    allowed.add(new URL(getEnv().SITE_URL).origin)
  } catch {
    // unset or invalid SITE_URL: rely on the request host only
  }
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (host) {
    const proto =
      request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '')
    allowed.add(`${proto}://${host}`)
  }
  try {
    allowed.add(new URL(request.url).origin)
  } catch {
    // ignore
  }
  return allowed.has(actual)
}

export const csrfFailed = () => fail(403, 'csrf', messages.errors.forbidden)
export const totpRequired = () => fail(403, 'totp_required', messages.errors.totpRequired)

/** docs/07: TOTP is mandatory for the admin role — permission routes refuse admins without it. */
const adminTotpMissing = async (user: SessionUser): Promise<boolean> => {
  if (user.role !== 'admin') return false
  const { findUserById } = await import('./users')
  const row = await findUserById(user.id)
  return !row?.totpEnabledAt
}

export type RouteParams<P extends Record<string, string> = Record<string, string>> = {
  params: Promise<P>
}

export type UserHandler<P extends Record<string, string>> = (
  request: Request,
  ctx: RouteParams<P>,
  user: SessionUser,
) => Promise<Response>

export interface WrapperOptions {
  /** Skip the Origin check (only for endpoints that must accept cross-site POSTs). */
  csrf?: boolean
}

type PageOptions = { returnTo?: string }

/**
 * `requireUser()` in a server component / server action: the signed-in user, or a redirect to
 * `/login?return=…`. `requireUser(handler)` in a route handler: 401 `{ error }` when
 * anonymous, 403 when a mutating request fails the Origin check, else the handler runs with
 * the user as the third argument.
 */
export function requireUser(options?: PageOptions): Promise<SessionUser>
export function requireUser<P extends Record<string, string> = Record<string, string>>(
  handler: UserHandler<P>,
  options?: WrapperOptions,
): (request: Request, ctx: RouteParams<P>) => Promise<Response>
export function requireUser<P extends Record<string, string> = Record<string, string>>(
  arg?: PageOptions | UserHandler<P>,
  options: WrapperOptions = {},
) {
  if (typeof arg === 'function') {
    const handler = arg
    return async (request: Request, ctx: RouteParams<P>): Promise<Response> => {
      if (options.csrf !== false && !sameOrigin(request)) return csrfFailed()
      const user = await getSessionUser()
      if (!user) return unauthorized()
      return handler(request, ctx, user)
    }
  }
  return (async () => {
    const user = await getSessionUser()
    if (!user) redirect(loginHref(arg?.returnTo))
    return user
  })()
}

/**
 * `withPermission(permission)` in a page: the user, or a redirect to login (anonymous) / a
 * 404 (signed in without the permission — admin surfaces stay invisible).
 * `withPermission(permission, handler)` wraps a route handler: 401 / 403 / handler.
 * Authorization is `can()` from @palscans/core — nothing else decides access.
 */
export function withPermission(permission: Permission, options?: PageOptions): Promise<SessionUser>
export function withPermission<P extends Record<string, string> = Record<string, string>>(
  permission: Permission,
  handler: UserHandler<P>,
  options?: WrapperOptions,
): (request: Request, ctx: RouteParams<P>) => Promise<Response>
export function withPermission<P extends Record<string, string> = Record<string, string>>(
  permission: Permission,
  arg?: PageOptions | UserHandler<P>,
  options: WrapperOptions = {},
) {
  if (typeof arg === 'function') {
    const handler = arg
    return async (request: Request, ctx: RouteParams<P>): Promise<Response> => {
      if (options.csrf !== false && !sameOrigin(request)) return csrfFailed()
      const user = await getSessionUser()
      if (!user) return unauthorized()
      if (!can(user, permission)) return forbidden()
      if (await adminTotpMissing(user)) return totpRequired()
      return handler(request, ctx, user)
    }
  }
  return (async () => {
    const user = await getSessionUser()
    if (!user) redirect(loginHref(arg?.returnTo))
    if (!can(user, permission)) {
      const { notFound: nf } = await import('next/navigation')
      nf()
    }
    return user
  })()
}

/** `/login?return=<path>` — pages pass their own path so the user lands back where they were. */
export const loginHref = (returnTo?: string): string =>
  returnTo && returnTo !== '/' ? `/login?return=${encodeURIComponent(returnTo)}` : '/login'
