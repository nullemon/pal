/**
 * Link safety for comment bodies.
 *
 * This file used to also export `renderHtml`, a comment body → HTML *string* renderer. It
 * was removed in the pre-launch security pass: nothing imported it, and it was the only
 * HTML-string path in the comment system. Every comment on the site is rendered as React
 * elements by `components/comments/CommentBody.tsx`, where escaping is the framework's job
 * and cannot be forgotten; a string renderer sitting beside it was a standing invitation to
 * pipe user content into `dangerouslySetInnerHTML` and have it look reviewed. If a
 * non-React consumer ever needs one (a mail digest, an RSS body), write it there against
 * that context's escaping rules rather than reviving a general one here.
 */

/** Only http(s) links survive; anything else (javascript:, data:) is rendered as text. */
export const safeHref = (href: string): string | null => {
  const trimmed = href.trim()
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed)
      return u.href
    } catch {
      return null
    }
  }
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(trimmed)) return `https://${trimmed}`
  return null
}
