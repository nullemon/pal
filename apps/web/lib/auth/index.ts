/**
 * Auth entry point for every other agent — see README.md in this folder.
 *
 *   import { getSessionUser, requireUser, withPermission } from '@/lib/auth'
 */
export {
  type BodyResult,
  csrfFailed,
  fail,
  forbidden,
  loginHref,
  MAX_JSON_BYTES,
  notFound,
  ok,
  parseJson,
  parseQuery,
  type RouteParams,
  rateLimited,
  readBody,
  requireUser,
  sameOrigin,
  totpRequired,
  type UserHandler,
  unauthorized,
  withPermission,
} from './http'
export { accountKey, clientIp, getRateLimiter, ipKey, type TrustedProxy } from './rate-limit'
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
  ipHashSalt,
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
