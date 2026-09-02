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

/** Parse a JSON body with a zod schema; malformed input is a 400 with the first issue. */
export const parseJson = async <T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<ParseResult<T>> => {
  let raw: unknown
  try {
    raw = await request.json()
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
