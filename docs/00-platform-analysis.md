# 00 — What asurascans.com is built on

Derived entirely from the page source, compiled CSS bundle, and inline auth JavaScript of
their homepage, series page, chapter reader, and login page. Live probing of the host was
blocked by the network proxy, so every claim below is traceable to something in the markup.

## Verdict

**A bespoke application.** Not WordPress+Madara (their previous stack, which they publicly
migrated off), not Strapi, not any off-the-shelf manga CMS. The footer credits
"Powered by Toraka", i.e. it was written by the operator of toraka.com.

## The stack

| Layer | Technology | Evidence |
|---|---|---|
| Site framework | Astro 7.2.4 | `<meta name="generator" content="Astro v7.2.4">` |
| Interactive components | React, as Astro islands | `<astro-island renderer-url="/_astro/client.*.js" client="load\|idle\|visible\|only">`; `client:only="react"` on the download modal |
| Styling | Tailwind CSS v4.3.3 (CSS-first config) | Bundle header `/*! tailwindcss v4.3.3 */`; `@layer theme`, `--color-*: oklch(...)`, `@property --tw-*` |
| Carousels | Embla Carousel | `embla-hero__container`, `embla-trending__slide`, `embla-announcements` |
| Cross-island state | nanostores (inferred) | source comment referencing `stores/novelBeta.ts` |
| API | A separate Go HTTP service on `api.asurascans.com` | see below |
| Edge / CDN | Cloudflare | Web Analytics beacon, Cloudflare Fonts (`/cf-fonts/...`), `CF-IPCountry`-driven SSR |
| Images | Content-addressed CDN, pre-generated widths | `cdn.asurascans.com/asura-images/...<hash6>.webp` and `-400.webp` |

## Why the backend is Go

Serialized chapter objects in list payloads contain `"created_at":"0001-01-01T00:00:00Z"`
for a field the query never selected. `0001-01-01T00:00:00Z` is the **`time.Time` zero
value** as marshalled by Go's `encoding/json` — an unset struct field, not a null column.
Rails, Laravel, and Django would each emit `null` or omit the key entirely.

Corroborating signals: snake_case JSON keys throughout, a `{"data": {...}}` response
envelope (`var userData = data.data || data`), `/api/...` route prefixes, and aggregate
ratings served as unrounded floats (`9.748434622467771`) that the client rounds.

## The API surface, verbatim from the login page

```
POST {API}/api/auth/login            {email, password}   credentials: 'include'
POST {API}/api/auth/register         {email, password}
POST {API}/api/auth/logout           {refresh_token}
POST {API}/api/auth/forgot-password  {email}
GET  {API}/api/auth/google           OAuth redirect, full page navigation
GET  {API}/api/me/                   Authorization: Bearer <access_token>
```

## Their auth model

Access and refresh tokens are written to **both** `localStorage` **and** cookies
(`access_token`, 1 day; `refresh_token`, 30 days; `path=/; SameSite=Lax`, not HttpOnly).
The cookies exist so the Astro SSR layer can read auth; localStorage exists so React
islands can. Roles: `user | basic | premium | staff | moderator | uploader | admin`.
Premium is time-boxed — `isPremiumActive()` is `staff-role OR (role in PAID_TIERS AND
premium_until > now)`.

## Weaknesses worth not repeating

1. **Sessions are XSS-exfiltratable.** Tokens sit in `localStorage` and in non-HttpOnly
   cookies. Any script injection — including one in a user comment that escapes
   sanitisation — walks away with a 30-day refresh token.
2. **Duplicated authorization logic.** Role and premium checks appear in two independent
   inline scripts; the content-mode switch appears in a third with a comment conceding
   "the two must be kept in step." Guaranteed drift.
3. **Shared-cached HTML plus client-side personalisation** produces a pre-paint flash, which
   they patch with `<body style="opacity:0">` and a 3-second failsafe timer. If that script
   fails, the page stays invisible.
4. **Deploy/caching fragility.** There is a global `error` listener that reloads the page
   when an `/_astro/*` chunk 404s, and a Safari-only `pageshow` handler that reloads when a
   Tailwind sentinel custom property is missing after bfcache restore. Both are symptoms.
5. **Cloudflare Fonts ships ~120 Noto Sans JP unicode-range subsets** into the head of a
   login page that renders no Japanese.
6. `aggregateRating.ratingCount` in their JSON-LD reuses the bookmark count, which is not
   the rating count.

Sections 1 and 2 are the ones that matter. The architecture in this repo fixes both by
construction: sessions are server-side and HttpOnly, and authorization exists once, on the
server, as a single permission check.
