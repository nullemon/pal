import { can, type Permission } from '@palscans/core'
import { messages } from '@palscans/core/messages'
import type { z } from 'zod'
import { type AppUser, getAppUser } from './viewer'

/** docs/16: every route handler answers `{ data }` or `{ error }`. */
export const ok = <T>(data: T, init?: ResponseInit): Response => Response.json({ data }, init)

export const fail = (status: number, error: string, message?: string): Response =>
  Response.json({ error, ...(message ? { message } : {}) }, { status })

export const unauthorized = () => fail(401, 'unauthorized', messages.errors.unauthorized)
export const forbidden = () => fail(403, 'forbidden', messages.errors.forbidden)
export const notFound = () => fail(404, 'not_found', messages.errors.notFound)

type ParseResult<T> = { ok: true; data: T } | { ok: false; response: Response }

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
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first?.path.length ? `${first.path.join('.')}: ` : ''
    return { ok: false, response: fail(400, 'validation', `${where}${first?.message ?? ''}`) }
  }
  return { ok: true, data: parsed.data }
}

/** Like `parseJson`, but an empty body yields `fallback` (e.g. a bare POST with defaults). */
export const parseJsonOptional = async <T>(
  request: Request,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<ParseResult<T>> => {
  const raw = await request.text()
  if (!raw.trim()) return { ok: true, data: fallback }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { ok: false, response: fail(400, 'invalid_json', messages.errors.validation) }
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, response: fail(400, 'validation', first?.message ?? '') }
  }
  return { ok: true, data: parsed.data }
}

export const parseQuery = <T>(request: Request, schema: z.ZodType<T>): ParseResult<T> => {
  const url = new URL(request.url)
  const raw: Record<string, string> = {}
  url.searchParams.forEach((v, k) => {
    raw[k] = v
  })
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first?.path.length ? `${first.path.join('.')}: ` : ''
    return { ok: false, response: fail(400, 'validation', `${where}${first?.message ?? ''}`) }
  }
  return { ok: true, data: parsed.data }
}

export type RouteParams<P extends Record<string, string> = Record<string, string>> = {
  params: Promise<P>
}

type UserHandler<P extends Record<string, string>> = (
  request: Request,
  ctx: RouteParams<P>,
  user: AppUser,
) => Promise<Response>

/** Route wrapper: the viewer must be signed in. Authorization beyond that is `can`/`entitlement`. */
export const requireUser =
  <P extends Record<string, string> = Record<string, string>>(handler: UserHandler<P>) =>
  async (request: Request, ctx: RouteParams<P>): Promise<Response> => {
    const user = await getAppUser()
    if (!user) return unauthorized()
    return handler(request, ctx, user)
  }

/** Route wrapper: signed in and holding a permission from @palscans/core. */
export const withPermission =
  <P extends Record<string, string> = Record<string, string>>(
    permission: Permission,
    handler: UserHandler<P>,
  ) =>
  async (request: Request, ctx: RouteParams<P>): Promise<Response> => {
    const user = await getAppUser()
    if (!user) return unauthorized()
    if (!can(user, permission)) return forbidden()
    return handler(request, ctx, user)
  }

/** Client IP hashed with the session secret so raw addresses are never stored (docs/14 §6). */
export const ipHashFor = async (request: Request): Promise<Uint8Array | null> => {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip')
  if (!ip) return null
  const { createHash } = await import('node:crypto')
  const salt = process.env.SESSION_SECRET ?? ''
  return new Uint8Array(createHash('sha256').update(`${salt}:${ip}`).digest())
}
