# `@/lib/auth`

Opaque server sessions (docs/07) and the wrappers every route handler, server component and
server action uses for authorization. Authorization itself is `can` / `entitlement` /
`canReadChapter` from `@palscans/core` — nothing here decides access on its own.

```ts
import { getSessionUser, requireUser, withPermission } from '@/lib/auth'
```

| Export | Where | What |
|---|---|---|
| `getSessionUser()` | server components, route handlers, actions | `SessionUser \| null`, memoised per request (`react.cache`). Reads the `sid` cookie, so the route becomes dynamic — call it only where you personalise. |
| `requireUser({ returnTo })` | pages / actions | The user, or `redirect('/login?return=<returnTo>')`. Pass the page's own path so the user lands back on it. |
| `requireUser(handler)` | route handlers | `(request, ctx, user) => Response`. Anonymous → `401 { error: 'unauthorized' }`. Mutating methods (POST/PUT/PATCH/DELETE) also need an `Origin`/`Referer` matching the site origin → otherwise `403 { error: 'csrf' }` (opt out with `{ csrf: false }` for endpoints that must accept cross-site POSTs). |
| `withPermission(permission, { returnTo })` | pages | Login redirect when anonymous, `notFound()` when signed in without the permission (admin surfaces stay invisible). |
| `withPermission(permission, handler)` | route handlers | 401 / 403 / handler, permission checked with `can()`. |
| `ok(data)`, `fail(status, error, message?)`, `parseJson(request, schema)`, `parseQuery(request, schema)` | route handlers | The `{ data } \| { error }` envelope and zod parsing (400 with the first issue). |
| `getSessionId()`, `createSession`, `rotateSession`, `revokeSession`, `revokeAllSessions`, `listSessions`, `invalidateSessionCache(userId)` | account / admin code | Session lifecycle. **Call `invalidateSessionCache` (or `revokeAllSessions`) after changing a user's role** so the cached session record is refreshed. |
| `getRateLimiter()` | anywhere server-side | `hit(key, limit, windowSec)` and `hitWithBackoff(...)`; Redis when `REDIS_URL` is set, in-process otherwise. |
| `safeReturnPath(value)` | pages | Whitelists `?return=` (same-origin path, never an auth page or `/api/*`). |

## How a session works

- Cookie `sid=<uuid>.<base64url 32 bytes>` — HttpOnly, SameSite=Lax, Path=/, 30 days, `Secure`
  when `SITE_URL` is https.
- `sessions` stores `sha256(secret)`; lookup is Redis-first (`sess:<id>` → `{userId, hash,
  expiry, lastSeen}`, TTL ≤ 1 day) with the table on a miss; the hash is compared in constant
  time. Revoking deletes the row's cache key.
- `last_seen_at` is refreshed at most every 5 minutes.
- The secret rotates on privilege change: login, password change, TOTP on/off. Password change
  and reset revoke every other session.
- Passwords: Argon2id `m=19456, t=2, p=1` (`password.ts`), rehashed on login when parameters
  change. New passwords are checked against Have I Been Pwned by k-anonymity (`hibp.ts`);
  the check fails open when the network is unavailable.
- Rate limits (`rate-limit.ts`): login 5/min per IP and per account with exponential backoff,
  register 3/h/IP, forgot-password 3/h/email (identical response either way), TOTP 6/5 min.
- OAuth (`oauth.ts`): arctic, authorization code + PKCE, state in a signed cookie. An identity
  whose email already has a password account is parked in a signed cookie and linked only
  after that account signs in with its password (`flows.ts` → `completePendingLink`).
- Emails go through `@/lib/email` — console locally, Resend when `RESEND_API_KEY` is set.
- Turnstile (`turnstile.ts`) verifies tokens only when `TURNSTILE_SECRET_KEY` is set.

## Routes

`/api/auth/*`: `register`, `login`, `login/totp`, `logout` (`{everywhere}`), `forgot-password`,
`reset-password`, `verify`, `resend-verification`, `onboarding`, `session` (GET),
`google` · `discord` (+ `/callback`).

`/api/me/*`: `profile` (PATCH), `username`, `theme`, `avatar` (POST presign · DELETE),
`avatar/upload` (PUT, fs driver only), `avatar/confirm`, `sessions` (GET · DELETE others),
`sessions/:id` (DELETE), `password`, `totp` (POST enrol · PATCH confirm · DELETE),
`export` (GET JSON), `delete` (POST schedule · DELETE cancel), `notifications` (POST read),
`notifications/prefs` (GET · PUT), `bookmarks/:seriesId` (PATCH · DELETE), `history` (DELETE).

Pages: `/login?return=&gate=premium`, `/register`, `/verify?token=`, `/forgot-password`,
`/reset-password?token=`, `/onboarding`, and `/me/{bookmarks,history,notifications,settings,security,billing}`.
