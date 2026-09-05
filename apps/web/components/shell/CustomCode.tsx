import { cssForStyleTag } from '@/lib/appearance/advanced'
import { cachedCustomCode } from '@/lib/appearance/published'

/**
 * docs/15 "Advanced": the operator's own CSS and their head / footer HTML, on the public
 * site and nowhere else.
 *
 * **Scoping is the whole design, and it is physical rather than clever.** These components
 * are mounted by `app/(site)/layout.tsx`. The panel (`app/admin`), the staff door
 * (`app/(staff)`) and the reader auth pages (`app/(auth)`) are sibling route groups with
 * their own layouts, so nothing here is in their tree at all — there is no selector to get
 * wrong, no prefix to escape and no `!important` to beat. An operator who pastes something
 * hostile cannot reach the screen that would let them undo it, which is what keeps a bad
 * save recoverable. `lib/appearance/scoping.test.ts` asserts the mounting, so a later edit
 * that moves either component into the root layout fails the build rather than the audit.
 *
 * **Ordering.** docs/15 says custom CSS is "applied after the theme". The token block is in
 * `<head>`; this `<style>` is the first thing in the site subtree, so it wins on document
 * order, and it is unlayered while Tailwind's utilities are in `@layer utilities`, so it
 * wins on the cascade too. An operator's `.card { margin: 0 }` therefore beats `m-4`, which
 * is the entire point of the box.
 *
 * **Content-Security-Policy.** There is one now — `lib/security/csp.ts`, sent by
 * `next.config.ts` on every HTML response. It is deliberately permissive *here*: the public
 * policy allows `'unsafe-inline'` and any `https:` host for script and style, so a pasted
 * analytics tag and an inline snippet both still run, and the hosts the Advanced screen
 * lists need no allowlisting. What it refuses is `<object>`/`<embed>`, a `<base>` tag, a
 * form posting off-site, and anything over plain `http:` — the Advanced screen says so in
 * as many words, because a CSP that silently breaks this feature would make the feature a
 * lie. docs/08 asked for nonces and no `'unsafe-inline'`; that is unreachable while these
 * pages are prerendered, and `lib/security/csp.ts` records exactly why.
 *
 * The panel gets a *different*, strict policy (`script-src 'self' 'unsafe-inline'`, no
 * third-party host, `frame-src 'none'`), which is what turns the scoping argument below
 * from an argument about where components are mounted into something the browser enforces.
 */

/** The `<style>` block, plus whatever the operator put in the "head" slot. */
export async function CustomCode() {
  const { css, head_html } = await cachedCustomCode()
  if (!css && !head_html) return null
  return (
    <>
      {css ? (
        <style
          id="palscans-custom-css"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: docs/15 "Advanced" — operator CSS, refused at save unless it parses, and stripped of any </style escape here as well
          dangerouslySetInnerHTML={{ __html: cssForStyleTag(css) }}
        />
      ) : null}
      {head_html ? <CustomHtml id="palscans-head-html" html={head_html} /> : null}
    </>
  )
}

/** The "footer" slot: the same thing, rendered after the page. */
export async function CustomFooterCode() {
  const { footer_html } = await cachedCustomCode()
  if (!footer_html) return null
  return <CustomHtml id="palscans-footer-html" html={footer_html} />
}

/**
 * The snippet itself. A `<div>` rather than a fragment because the markup is opaque to React
 * and has to hang off a real node; `display: contents` keeps it out of the layout, so a
 * snippet cannot introduce a gap or a scrollbar the way an empty block would.
 *
 * Scripts inside run because they are parser-inserted into the streamed HTML — the same
 * reason they run in a `<head>` — and they run once per full page load, not again on client
 * navigation, which is what an analytics loader expects.
 */
function CustomHtml({ id, html }: { id: string; html: string }) {
  return (
    <div
      id={id}
      style={{ display: 'contents' }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: docs/15 "Advanced" — the operator's own snippet, admin-only and tag-balanced at save; this is the feature
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
