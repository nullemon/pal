/**
 * The announcement bar's "rich text" (docs/15 "Announcement bar: rich text").
 *
 * Operator-authored copy that renders inside every page's `<body>` must not be raw HTML: a
 * staff account with `settings.write` would otherwise be one paste away from a stored XSS on
 * the whole site, admin panel included. So the bar accepts a deliberately tiny inline
 * grammar and is rendered as React elements — there is no `dangerouslySetInnerHTML` anywhere
 * on this path, which means an escaped `<script>` stays text no matter what.
 *
 * The grammar:
 *
 *   [label](/path)   a link — internal paths and http(s) URLs only
 *   **bold**         strong
 *   *italic*         emphasis
 *
 * Anything else is literal text. Nesting is not supported (and not wanted at 13px in a bar).
 */

export type InlineNode =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'link'; text: string; href: string; external: boolean }

/**
 * Targets we will turn into a link: a site-relative path, or an absolute http(s) URL. Never
 * `javascript:`, `data:` or a protocol-relative `//host` that inherits the page's scheme.
 */
export const safeHref = (raw: string): { href: string; external: boolean } | null => {
  const href = raw.trim()
  if (!href || /\s/.test(href)) return null
  if (href.startsWith('//')) return null
  if (href.startsWith('/') || href.startsWith('#')) return { href, external: false }
  if (/^https?:\/\/[^/]/i.test(href)) return { href, external: true }
  return null
}

const LINK = /\[([^\]\n]{1,120})\]\(([^)\s]{1,300})\)/
const STRONG = /\*\*([^*\n]{1,300})\*\*/
const EM = /\*([^*\n]{1,300})\*/

/**
 * Split one line of the grammar above into nodes. Deliberately a single left-to-right pass:
 * whichever of the three markers appears first wins and the remainder is re-scanned, so a
 * malformed marker degrades to plain text instead of swallowing the rest of the bar.
 */
export const parseInline = (input: string): InlineNode[] => {
  const out: InlineNode[] = []
  let rest = input
  let guard = 0
  while (rest && guard++ < 200) {
    const link = LINK.exec(rest)
    const strong = STRONG.exec(rest)
    const em = EM.exec(rest)
    const candidates = [
      link ? ({ at: link.index, m: link, kind: 'link' } as const) : null,
      strong ? ({ at: strong.index, m: strong, kind: 'strong' } as const) : null,
      em ? ({ at: em.index, m: em, kind: 'em' } as const) : null,
    ].filter((c) => c !== null)
    if (candidates.length === 0) break
    // `**bold**` also matches the `*italic*` pattern at the same offset; strong must win.
    const first = candidates.sort((a, b) =>
      a.at !== b.at ? a.at - b.at : a.kind === 'strong' ? -1 : b.kind === 'strong' ? 1 : 0,
    )[0] as (typeof candidates)[number]
    const before = rest.slice(0, first.at)
    if (before) out.push({ kind: 'text', text: before })
    const whole = first.m[0]
    const a = first.m[1] ?? ''
    const b = first.m[2] ?? ''
    if (first.kind === 'link') {
      const target = safeHref(b)
      if (target) out.push({ kind: 'link', text: a, href: target.href, external: target.external })
      else out.push({ kind: 'text', text: whole })
    } else {
      out.push({ kind: first.kind, text: a })
    }
    rest = rest.slice(first.at + whole.length)
  }
  if (rest) out.push({ kind: 'text', text: rest })
  return out
}

/** The bar's text with the markup removed — used for the dismissal id and for screen readers. */
export const plainInline = (input: string): string =>
  parseInline(input)
    .map((n) => n.text)
    .join('')
