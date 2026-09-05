import { cookies, draftMode } from 'next/headers'
import { audit } from '@/components/admin/server/audit'
import { decodePreviewScopes, encodePreviewScopes, PREVIEW_COOKIE } from '@/lib/appearance/scope'
import { fail, safeReturnPath, withPermission } from '@/lib/auth'

/**
 * `GET /api/admin/appearance/preview?scope=brand.menus&to=/` — turn a draft preview on, and
 * `?stop=1` to turn it off (docs/15 "Preview: every change is a draft until published. Staff
 * see the draft on the live site; nobody else does").
 *
 * ## What the two cookies do
 *
 * `draftMode().enable()` sets Next's `__prerender_bypass`, whose value is a random id minted
 * at `next build`. That cookie is a **cache instruction**, not a credential: it makes this
 * browser's requests render on demand instead of being served the prerendered HTML, which is
 * the only reason a per-viewer document can be read at all without making the site dynamic
 * for everyone (see `lib/appearance/preview.ts`).
 *
 * `ps_appearance_preview` names which screens' drafts to show. It is not a credential
 * either — the render path re-checks `settings.write` on the session for every request. A
 * stolen or guessed pair of cookies gets an anonymous visitor an on-demand render of the
 * **published** site, which is what they would have been served anyway.
 *
 * Both are host-only, `httpOnly`, `SameSite=Lax` and session-scoped: closing the browser
 * ends the preview, which is the behaviour an operator expects from "preview" and one less
 * thing to remember to switch off.
 *
 * `GET` rather than a form post because this is a link an operator clicks from the admin
 * screen, and because Next's own draft-mode contract is a GET route handler. The
 * consequence is honest to state: a signed-in operator who follows a hostile link ends up
 * looking at their own site's drafts. That is the whole of the impact — no write, no
 * disclosure to the attacker — and it is undone by the Exit link on the banner.
 */
export const GET = withPermission('settings.write', async (request, _ctx, user) => {
  const url = new URL(request.url)
  const to = safeReturnPath(url.searchParams.get('to'), '/')
  const stop = url.searchParams.get('stop') === '1'
  const draft = await draftMode()
  const jar = await cookies()

  if (stop) {
    draft.disable()
    jar.delete(PREVIEW_COOKIE)
  } else {
    const scopes = decodePreviewScopes(url.searchParams.get('scope'))
    if (scopes.length === 0) return fail(400, 'validation', 'Name at least one appearance scope.')
    draft.enable()
    jar.set(PREVIEW_COOKIE, encodePreviewScopes(scopes), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: url.protocol === 'https:',
    })
    // Worth an audit row: it is the one action that makes unpublished content reachable over
    // the public URLs, and "who was looking at a draft on Tuesday" is a fair question.
    await audit({
      actorId: user.id,
      action: 'appearance.preview',
      targetType: 'appearance',
      after: { scopes },
      request,
    })
  }
  // 303 so the browser follows with GET regardless of how it got here.
  return new Response(null, { status: 303, headers: { location: to } })
})
