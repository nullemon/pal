/**
 * Content-Security-Policy for the HTML this app serves (docs/08 "Security baseline").
 *
 * ## Why there is no nonce, when docs/08 asked for one
 *
 * docs/08 wants "CSP with nonces, no `unsafe-inline`". That is the right policy and it is
 * not reachable on this deployment without giving up something worse. Next's own guide is
 * explicit about the constraint (`node_modules/next/dist/docs/01-app/02-guides/
 * content-security-policy.md`, "How nonces work in Next.js"): *"To use a nonce, your page
 * must be dynamically rendered. … Static pages are generated at build time, when no request
 * or response headers exist—so no nonce can be injected."* Adopting nonces therefore means
 * `/terms`, `/privacy`, `/genres`, `/announcements`, `/contact`, `/dmca`, `/rankings/*` and
 * the rest of the static set become server-rendered on demand, on a site whose whole
 * rendering strategy (docs/06) is built on them not being.
 *
 * It would not even buy `no 'unsafe-inline'`. Next inlines the RSC flight payload as
 * `<script>self.__next_f.push(…)</script>` in the prerendered HTML itself, and that HTML is
 * written at build time, before any request and any nonce exists. Measured on this build:
 * the prerendered `/terms` carries five executable inline scripts — the pre-paint theme
 * script and four flight-payload chunks — plus the inline `<style>` from
 * `lib/appearance/AppearanceStyle.tsx`. Hash-pinning them is no better: the payload changes
 * with the page's data, so the hashes change on every revalidation.
 *
 * So `script-src` carries `'unsafe-inline'` and this policy does not pretend to stop XSS on
 * a page that has an injection. What it does do is stop the things that do not need inline
 * script to be dangerous, and those are worth having on their own:
 *
 * - `object-src 'none'` — no `<object>`, `<embed>`, no Flash-shaped legacy plugin content.
 * - `base-uri 'self'` — an injected `<base href>` cannot re-point every relative URL on the
 *   page (including the script tags Next emits) at another origin.
 * - `form-action 'self'` — a form cannot be made to POST somewhere else, which is the
 *   cheapest credential-stealing primitive there is.
 * - `frame-ancestors 'self'` — clickjacking, and the modern spelling of the
 *   `X-Frame-Options: SAMEORIGIN` that `infra/Caddyfile` already sends.
 * - Scheme restriction everywhere else: subresources must be `https:` (or same-origin, or a
 *   `data:`/`blob:` where the app genuinely uses one). No `http:` script, style, image or
 *   fetch can load, so a mixed-content or downgrade path is closed.
 *
 * ## Two policies, because the panel has different content
 *
 * The public site renders operator-authored code by design (docs/15 "Advanced": custom CSS,
 * a head snippet and a footer snippet, which is where an analytics tag goes) and operator-
 * supplied ad tags (docs/11), which are arbitrary third-party script by definition. A policy
 * that named allowed hosts would break them the first time a tag loaded a second script from
 * a host nobody listed — silently, which is the worst way for a CSP to fail. So the public
 * policy allows `https:` scripts and states that plainly on the Advanced screen.
 *
 * The admin panel renders none of that. `components/shell/CustomCode.tsx` is mounted by
 * `app/(site)/layout.tsx` and nowhere else, and ad slots never render there. So `/admin` —
 * which includes the staff door and the admin API — gets a policy with **no third-party
 * script or frame at all**: `script-src 'self' 'unsafe-inline'`, `frame-src 'none'`. The
 * separation between operator content and the screen that can undo it was physical
 * (different route groups, different layouts); this makes it enforced.
 *
 * ## What is left, and what it would take to close it
 *
 * `'unsafe-inline'` in `script-src`, on both policies, and `https:` for script on the public
 * site. Closing the first needs `next start` to render every page dynamically, or a Next
 * release that lets a nonce be attached to prerendered output. Closing the second needs the
 * operator to declare every host their snippets and ad tags reach — including the ones those
 * scripts load in turn — which nobody can enumerate reliably; a `Content-Security-Policy-
 * Report-Only` pass in production is the honest way to find out what a real deployment
 * actually loads before tightening it.
 *
 * Also deliberately absent: `upgrade-insecure-requests` (HSTS from Caddy covers the site
 * host, and it would break `next start` on a plain-http box during a verification run), and
 * `report-uri` / `report-to` (there is no collector; docs/08's Sentry is not wired to one).
 */

export type PolicyName = 'site' | 'panel'

const COMMON = {
  'default-src': ["'self'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'self'"],
  'manifest-src': ["'self'"],
  // `/sw.js` (docs/06 "Mobile specifics"); `blob:` for workers built in the page.
  'worker-src': ["'self'", 'blob:'],
} as const

/**
 * The public site: operator snippets, ad tags and Turnstile all live here, and all three are
 * third-party script the operator chose. `https:` rather than a host list — see above.
 */
const SITE: Record<string, readonly string[]> = {
  ...COMMON,
  'script-src': ["'self'", "'unsafe-inline'", 'https:'],
  'style-src': ["'self'", "'unsafe-inline'", 'https:'],
  // Covers and pages come from the CDN host, which is operator-configurable at runtime and
  // so cannot be baked into a build-time header; comment images and ad creatives are on
  // hosts nobody enumerates. `data:`/`blob:` are the reader's own: QR codes for TOTP
  // enrolment, and the offline downloads the service worker hands back.
  'img-src': ["'self'", 'data:', 'blob:', 'https:'],
  'font-src': ["'self'", 'data:', 'https:'],
  'connect-src': ["'self'", 'https:'],
  'media-src': ["'self'", 'data:', 'blob:', 'https:'],
  // Ad networks and Turnstile both render in an iframe.
  'frame-src': ['https:'],
}

/**
 * The admin panel, the staff door and the admin API. No operator-authored code is in this
 * tree, so nothing here may load or frame a third party.
 */
const PANEL: Record<string, readonly string[]> = {
  ...COMMON,
  'script-src': ["'self'", "'unsafe-inline'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  // The panel shows covers, avatars and page thumbnails from the CDN, and previews the file
  // being uploaded from a `blob:` URL before it leaves the browser.
  'img-src': ["'self'", 'data:', 'blob:', 'https:'],
  'font-src': ["'self'", 'data:'],
  // Bulk upload PUTs straight to object storage with a presigned URL, so the bucket's own
  // origin has to be reachable; it is operator-configurable, hence the scheme rather than a
  // host (docs/19 — `storage.s3_endpoint` lives in the panel, not in the build).
  'connect-src': ["'self'", 'https:'],
  'media-src': ["'self'", 'data:', 'blob:', 'https:'],
  'frame-src': ["'none'"],
}

const POLICIES: Record<PolicyName, Record<string, readonly string[]>> = { site: SITE, panel: PANEL }

/** The header value for one policy, directives in a stable order. */
export const csp = (name: PolicyName): string =>
  Object.entries(POLICIES[name])
    .map(([directive, values]) => `${directive} ${values.join(' ')}`)
    .join('; ')

/** One directive's sources, for tests and for the copy that tells operators what is allowed. */
export const cspDirective = (name: PolicyName, directive: string): readonly string[] =>
  POLICIES[name][directive] ?? []

/**
 * The `headers()` entries for `next.config.ts`.
 *
 * The sources are mutually exclusive on purpose. Two entries that both matched would both be
 * applied and the browser would enforce the intersection — which is not obviously wrong, but
 * it is a policy nobody wrote down, and reading two CSP headers off a response to work out
 * what is in force is exactly the debugging session this file exists to avoid.
 *
 * `/api/*`, `/_next/*` and `/_storage/*` are excluded: they serve JSON, hashed assets and
 * image bytes, `/api/storage` sets its own sandboxing policy already, and a CSP on an image
 * response means nothing.
 */
export const securityHeaders = () => {
  const header = (name: PolicyName) => [{ key: 'Content-Security-Policy', value: csp(name) }]
  return [
    { source: '/admin', headers: header('panel') },
    { source: '/admin/:path*', headers: header('panel') },
    { source: '/api/admin/:path*', headers: header('panel') },
    { source: '/', headers: header('site') },
    {
      source: '/:path((?!admin$|admin/|api/|_next/|_storage/).*)',
      headers: header('site'),
    },
  ]
}
