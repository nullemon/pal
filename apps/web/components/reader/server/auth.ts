/**
 * Reader route helpers. These are the canonical wrappers from `lib/auth` (P4): the response
 * shape and `requireUser`, which checks the request Origin on mutating methods (docs/07)
 * before resolving the session. Access beyond sign-in is decided by `@palscans/core`
 * (`canReadChapter`, `entitlement`) inside the handler.
 */
export {
  fail,
  forbidden,
  notFound,
  ok,
  parseJson,
  type RouteParams,
  requireUser,
  unauthorized,
} from '@/lib/auth'
