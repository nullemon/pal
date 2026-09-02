import type { SessionUser } from '@palscans/core'
import { messages } from '@palscans/core/messages'
import { getSessionUser } from '@/lib/auth/session'

/** docs/16: every route handler answers `{ data }` or `{ error }`. */
export const ok = <T>(data: T, init?: ResponseInit): Response => Response.json({ data }, init)

export const fail = (status: number, error: string, message?: string): Response =>
  Response.json({ error, ...(message ? { message } : {}) }, { status })

export const unauthorized = () => fail(401, 'unauthorized', messages.errors.unauthorized)
export const forbidden = () => fail(403, 'forbidden', messages.errors.forbidden)
export const notFound = () => fail(404, 'not_found', messages.errors.notFound)

export type RouteParams<P extends Record<string, string> = Record<string, string>> = {
  params: Promise<P>
}

type UserHandler<P extends Record<string, string>> = (
  request: Request,
  ctx: RouteParams<P>,
  user: SessionUser,
) => Promise<Response>

/**
 * Route wrapper: the viewer must be signed in. Access beyond that is decided by
 * `@palscans/core` (`canReadChapter`, `entitlement`) inside the handler. P4 owns the
 * canonical wrappers in `lib/auth`; this one only reads the session the same way.
 */
export const requireUser =
  <P extends Record<string, string> = Record<string, string>>(handler: UserHandler<P>) =>
  async (request: Request, ctx: RouteParams<P>): Promise<Response> => {
    const user = await getSessionUser()
    if (!user) return unauthorized()
    return handler(request, ctx, user)
  }
