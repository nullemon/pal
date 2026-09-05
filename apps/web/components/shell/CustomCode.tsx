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
 * **Content-Security-Policy.** There is none on this app's HTML responses today — see
 * `infra/Caddyfile`, which sets HSTS, nosniff, X-Frame-Options, Referrer-Policy and
 * Permissions-Policy and no CSP, and `proxy.ts`, which adds none either. So a pasted
 * analytics tag runs. docs/08 wants "CSP with nonces, no `unsafe-inline`" and the day that
 * lands, an inline `<style>`, an inline `<script>` and every third-party host in these
 * snippets need to be in it — the Advanced screen lists the hosts each snippet loads from
 * for exactly that reason. This comment is the marker to search for on that day.
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
