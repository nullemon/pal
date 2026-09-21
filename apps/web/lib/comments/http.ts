import { messages } from '@palscans/core/messages'
import type { z } from 'zod'
import { csrfFailed, fail, type RouteParams, readBody, sameOrigin, unauthorized } from '@/lib/auth'
import { type AppUser, getAppUser } from './viewer'

/**
 * Comment-route helpers. The response shape, query parsing and the CSRF Origin check are
 * the canonical ones from `lib/auth`; only the viewer type (`AppUser`, with the profile
 * fields the pipeline needs) and the bounded JSON body parser are specific to comments.
 */
export {
  fail,
  forbidden,
  notFound,
  ok,
  parseQuery,
  type RouteParams,
  rateLimited,
  unauthorized,
} from '@/lib/auth'

type ParseResult<T> = { ok: true; data: T } | { ok: false; response: Response }

/** Comment bodies are structurally capped; a raw JSON body larger than this is refused outright. */
export const MAX_JSON_BYTES = 32 * 1024

const tooLarge = () => fail(413, 'too_large', messages.commentThread.tooLong)

const parseWith = <T>(raw: string, schema: z.ZodType<T>): ParseResult<T> => {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { ok: false, response: fail(400, 'invalid_json', messages.errors.validation) }
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first?.path.length ? `${first.path.join('.')}: ` : ''
    return { ok: false, response: fail(400, 'validation', `${where}${first?.message ?? ''}`) }
  }
  return { ok: true, data: parsed.data }
}

/** Content-Length first, then a streaming cap — the body is never buffered past the limit. */
const readCapped = async (request: Request): Promise<ParseResult<string>> => {
  const read = await readBody(request, MAX_JSON_BYTES)
  if (!read.ok) return { ok: false, response: tooLarge() }
  return { ok: true, data: new TextDecoder().decode(read.body) }
}

/** Parse a JSON body (≤ 32 KB) with a zod schema; malformed input is a 400 with the first issue. */
export const parseJson = async <T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<ParseResult<T>> => {
  const raw = await readCapped(request)
  if (!raw.ok) return raw
  return parseWith(raw.data, schema)
}

/** Like `parseJson`, but an empty body yields `fallback` (e.g. a bare POST with defaults). */
export const parseJsonOptional = async <T>(
  request: Request,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<ParseResult<T>> => {
  const raw = await readCapped(request)
  if (!raw.ok) return raw
  if (!raw.data.trim()) return { ok: true, data: fallback }
  return parseWith(raw.data, schema)
}

type UserHandler<P extends Record<string, string>> = (
  request: Request,
  ctx: RouteParams<P>,
  user: AppUser,
) => Promise<Response>

/**
 * Route wrapper: same-origin (docs/07 Origin check on every mutating route) and signed in.
 * Authorization beyond that is `can`/`entitlement`, decided inside the handler.
 *
 * There is deliberately no `withPermission` twin here. One existed, unused, alongside this:
 * a second wrapper that also called `can(user, permission)`. Two wrappers that differ only
 * in whether they check a permission is the shape that eventually gets the wrong one
 * imported — so the permission-checking route wrapper lives in exactly one place,
 * `@/lib/auth`, and the comment routes call `can()` where the decision is made.
 */
export const requireUser =
  <P extends Record<string, string> = Record<string, string>>(handler: UserHandler<P>) =>
  async (request: Request, ctx: RouteParams<P>): Promise<Response> => {
    if (!sameOrigin(request)) return csrfFailed()
    const user = await getAppUser()
    if (!user) return unauthorized()
    return handler(request, ctx, user)
  }
