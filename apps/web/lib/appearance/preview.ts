import 'server-only'

import { cookies, draftMode } from 'next/headers'
import { cache } from 'react'
import { type AppearanceScope, decodePreviewScopes, PREVIEW_COOKIE } from './scope'

/**
 * "Staff see the draft on the live site; nobody else does" (docs/15 "Presets, preview,
 * history") — and the site stays prerendered for everybody else while they do.
 *
 * ## The problem this solves
 *
 * The header, footer, token block and copy are read by `lib/chrome/load.ts`,
 * `lib/appearance/AppearanceStyle.tsx` and `lib/copy/settings.ts`, each an `unstable_cache`
 * entry with **no request-scoped input**. That is exactly what keeps the layout static and
 * what keeps a page render from touching Postgres. Previewing means reading a *different*
 * document for *one viewer*, which is request-scoped by definition — so a naive
 * `cookies()`/`searchParams` check in the layout would make every route in the app dynamic
 * and cost a database round trip per request for readers who will never see a draft.
 *
 * ## Why this does not
 *
 * Next's **Draft Mode** is the one request-scoped input the framework itself is built to
 * keep off the static path:
 *
 * - During a prerender (`next build`, and every ISR regeneration) `draftMode()` resolves
 *   against a *null provider*: `isEnabled` is `false` and nothing is tracked as dynamic
 *   access. Reading it does not deopt a route — the framework special-cases it, and
 *   `next/dist/server/request/draft-mode.js` is explicit about which work-unit kinds get the
 *   empty value. Only `enable()`/`disable()` mark a render dynamic, and those are only ever
 *   called from a route handler.
 * - At request time the `__prerender_bypass` cookie — set by `enable()`, its value a random
 *   per-build id — is what makes Next skip the prerendered HTML and render on demand for
 *   *that* request. Everybody else keeps being served the static page.
 *
 * So the check below is free on the static path (`isEnabled` is false, we return before
 * `cookies()` is ever touched) and complete on the preview path. The prerendered-page count
 * in `next build` is the same before and after this landed, which is the property to
 * regression-test.
 *
 * ## Who may see a draft
 *
 * Two independent gates, because a bypass cookie is a cache instruction and not a
 * credential:
 *
 * 1. `__prerender_bypass` must be present and match this build — only
 *    `/api/admin/appearance/preview`, itself behind `withPermission('settings.write')`, ever
 *    sets it.
 * 2. **The session is re-checked here, on every render.** A viewer who somehow has the
 *    bypass cookie but is anonymous, signed out, demoted, or simply a reader gets an empty
 *    scope set and therefore the published site. Losing the permission ends the preview on
 *    the next request; no invalidation step to forget.
 *
 * Failure is silent and closed: anything unexpected (no request scope, an unreachable
 * session store) resolves to "not previewing", which renders what is published.
 */

const NONE: readonly AppearanceScope[] = Object.freeze([])

/**
 * The scopes this request is previewing. Empty for every anonymous visitor, always.
 *
 * `cache()` so the layout, the header, the copy provider and the preview banner resolve it
 * once per request between them.
 */
export const previewScopes = cache(async (): Promise<readonly AppearanceScope[]> => {
  try {
    // Gate 1. False during every prerender, so nothing below runs at build time and the
    // route is not marked dynamic.
    const { isEnabled } = await draftMode()
    if (!isEnabled) return NONE

    // Gate 2. Re-authorise the viewer on this render rather than trusting the cookie.
    // Imported lazily: `lib/chrome/load.ts` is on the static render path of every page and
    // has no business carrying the session module in its graph for a branch it will not take.
    const { getSessionUser } = await import('@/lib/auth')
    const { can } = await import('@palscans/core')
    const user = await getSessionUser()
    if (!user || !can(user, 'settings.write')) return NONE

    const raw = (await cookies()).get(PREVIEW_COOKIE)?.value
    const scopes = decodePreviewScopes(raw)
    return scopes.length ? Object.freeze(scopes) : NONE
  } catch {
    return NONE
  }
})

/** `true` when this request is previewing the named scope. */
export const isPreviewing = async (scope: AppearanceScope): Promise<boolean> =>
  (await previewScopes()).includes(scope)
