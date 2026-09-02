/**
 * Auth entry point for every other agent — see README.md in this folder.
 *
 *   import { getSessionUser, requireUser, withPermission } from '@/lib/auth'
 */
export {
  csrfFailed,
  fail,
  forbidden,
  loginHref,
  notFound,
  ok,
  parseJson,
  parseQuery,
  type RouteParams,
  rateLimited,
  requireUser,
  sameOrigin,
  type UserHandler,
  unauthorized,
  withPermission,
} from './http'
export { clientIp, getRateLimiter } from './rate-limit'
export { safeReturnPath, withReturn } from './return-to'
export {
  type ActiveSession,
  clearSessionCookie,
  createSession,
  getSessionId,
  getSessionUser,
  hashIp,
  hashSessionSecret,
  invalidateSessionCache,
  listSessions,
  loadSessionUser,
  type ParsedSessionCookie,
  parseSessionCookie,
  resolveSession,
  revokeAllSessions,
  revokeSession,
  rotateSession,
  SESSION_COOKIE,
  setSessionCookie,
} from './session'
