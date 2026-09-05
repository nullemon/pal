/**
 * The vocabulary shared by every part of the draft → preview → publish workflow
 * (docs/15 "Presets, preview, history").
 *
 * **This module imports nothing on purpose.** The admin client screens name a scope in a
 * link, the server modules key a version stream on it, the route handlers validate one out
 * of a query string, and the public site reads one out of a cookie — so it has to be safe
 * in a browser bundle, inside `server-only` code, and inside a zod schema alike. Anything
 * with a dependency belongs in `./documents.ts` (server) or `./diff.ts` (pure) instead.
 */

/**
 * One version stream per Appearance screen.
 *
 * They publish **independently**, and that is a decision rather than an accident. Brand and
 * Menus do render into the same header, so "one appearance version covering everything" was
 * the alternative — but each screen has its own Save control, its own operator and its own
 * audit trail, and a single publish button would mean shipping a colleague's half-finished
 * footer the moment you renamed the site. What the two screens share is the *preview*: a
 * preview session names the scopes it is showing, so an operator who wants to see a new
 * wordmark next to a new nav asks for both and the banner says so.
 */
export const APPEARANCE_SCOPES = ['theme', 'brand', 'menus', 'copy'] as const
export type AppearanceScope = (typeof APPEARANCE_SCOPES)[number]

export const isAppearanceScope = (value: unknown): value is AppearanceScope =>
  typeof value === 'string' && (APPEARANCE_SCOPES as readonly string[]).includes(value)

/**
 * The cookie naming the scopes a preview session is showing.
 *
 * It is *not* the gate. Next's own `__prerender_bypass` cookie is what makes the render
 * happen at request time, and `lib/appearance/preview.ts` re-checks `settings.write` on the
 * session before a single draft field is read — so this cookie only ever narrows what a
 * viewer who is already entitled to the draft is looking at.
 */
export const PREVIEW_COOKIE = 'ps_appearance_preview'

/** Serialise / parse the cookie's value. Unknown names are dropped rather than trusted. */
export const encodePreviewScopes = (scopes: readonly AppearanceScope[]): string =>
  [...new Set(scopes)].join('.')

export const decodePreviewScopes = (raw: string | undefined | null): AppearanceScope[] =>
  (raw ?? '')
    .split('.')
    .filter(isAppearanceScope)
    .filter((s, i, all) => all.indexOf(s) === i)

/** The staff-only link that turns a preview on. `to` is where the operator lands. */
export const previewStartHref = (scopes: readonly AppearanceScope[], to = '/'): string =>
  `/api/admin/appearance/preview?scope=${encodeURIComponent(encodePreviewScopes(scopes))}&to=${encodeURIComponent(to)}`

/** …and off again. */
export const previewStopHref = (to = '/'): string =>
  `/api/admin/appearance/preview?stop=1&to=${encodeURIComponent(to)}`
