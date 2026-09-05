/**
 * docs/15 "Advanced": the operator's own CSS and their head / footer HTML snippets, checked
 * before they are allowed anywhere near a reader.
 *
 * Pure and dependency-free on purpose. The admin screen runs it as you type, the API route
 * runs it again before it writes, and the tests run it on its own — one definition, three
 * callers, no zod and no React reachable from here (docs/20: a client module that reaches
 * into a zod-carrying module cost 84 KB gzipped, twice).
 *
 * **What this is and is not.** It is not a sandbox. `appearance.advanced` is admin-only
 * precisely because nothing here can contain a hostile administrator — a `<script>` is a
 * `<script>`. What it does contain is the realistic failure: an administrator pasting
 * something they have not read, or a stylesheet with an unbalanced brace that takes the
 * public site down until somebody notices. So the rules split in two:
 *
 * - **Refused** (`errors`): things that break the page, escape the element they are in, or
 *   send the reader's IP address to a third party without the operator meaning to. A save
 *   with an error is rejected by the route, so an invalid document is never rendered.
 * - **Flagged** (`warnings`): things that are legitimate but easy to get wrong. These are
 *   shown on the screen and saved anyway; refusing them would only teach operators that the
 *   box is broken.
 */

export type CssProblemCode =
  | 'too_long'
  | 'unbalanced_braces'
  | 'unclosed_brace'
  | 'unterminated_string'
  | 'unterminated_comment'
  | 'style_escape'
  | 'import_rule'
  | 'remote_url'
  | 'unsafe_value'
  | 'covers_viewport'
  | 'hides_page'

export type HtmlProblemCode =
  | 'too_long'
  | 'unbalanced_tags'
  | 'stray_close_tag'
  | 'element_not_allowed'
  | 'meta_tag'
  | 'document_write'

export interface Problem<Code extends string> {
  code: Code
  /** 1-based line the problem starts on, for the editor gutter. */
  line: number
  /** The offending token (a tag name, a host, a property) — copy interpolates it. */
  detail?: string
}

export interface CheckResult<Code extends string> {
  errors: Problem<Code>[]
  warnings: Problem<Code>[]
  /** Off-origin hosts the document would fetch from. Empty is the good answer. */
  hosts: string[]
}

/** Hard caps. The whole appearance document is posted as one JSON body under 64 KB. */
export const CSS_MAX_LENGTH = 20_000
export const SNIPPET_MAX_LENGTH = 8_000

const lineOf = (source: string, index: number): number => {
  let line = 1
  for (let i = 0; i < index && i < source.length; i++) if (source.charCodeAt(i) === 10) line++
  return line
}

/** `https://a.example/x` → `a.example`; a relative or data URL → null. */
export const hostOf = (raw: string): string | null => {
  const value = raw.trim().replace(/^['"]|['"]$/g, '')
  if (value.startsWith('//')) return value.slice(2).split(/[/?#]/)[0]?.toLowerCase() || null
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(value)
  if (!m) return null
  const scheme = (m[1] as string).toLowerCase()
  if (scheme === 'data' || scheme === 'blob') return null
  if (scheme !== 'http' && scheme !== 'https') return scheme
  return value.slice(m[0].length).replace(/^\/\//, '').split(/[/?#]/)[0]?.toLowerCase() || null
}

/* ------------------------------------------------------------------------------ CSS */

interface CssScan {
  /** The stylesheet with comments and string bodies blanked out, same length as the input. */
  bare: string
  problems: Problem<CssProblemCode>[]
}

/**
 * One pass over the stylesheet that both validates the lexical structure and produces a
 * "bare" copy with comments and string contents blanked. Everything after it can use plain
 * regexes without a `url("/* not a comment *\/")` or a semicolon inside a quoted font name
 * throwing the answer off.
 */
const scanCss = (css: string): CssScan => {
  const problems: Problem<CssProblemCode>[] = []
  const out: string[] = []
  let depth = 0
  let openAt = -1
  let i = 0
  while (i < css.length) {
    const ch = css[i] as string
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      if (end === -1) {
        problems.push({ code: 'unterminated_comment', line: lineOf(css, i) })
        for (; i < css.length; i++) out.push(css[i] === '\n' ? '\n' : ' ')
        break
      }
      for (let k = i; k < end + 2; k++) out.push(css[k] === '\n' ? '\n' : ' ')
      i = end + 2
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      out.push(' ')
      let k = i + 1
      let closed = false
      for (; k < css.length; k++) {
        const c = css[k] as string
        if (c === '\\') {
          out.push(' ')
          if (k + 1 < css.length) {
            out.push(css[k + 1] === '\n' ? '\n' : ' ')
            k++
          }
          continue
        }
        if (c === '\n') break // an unescaped newline ends a CSS string — it is unterminated
        if (c === quote) {
          closed = true
          break
        }
        out.push(' ')
      }
      if (!closed) {
        problems.push({ code: 'unterminated_string', line: lineOf(css, i) })
        for (; i < css.length; i++) out.push(css[i] === '\n' ? '\n' : ' ')
        break
      }
      out.push(' ')
      i = k + 1
      continue
    }
    if (ch === '{') {
      if (depth === 0) openAt = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth < 0) {
        problems.push({ code: 'unbalanced_braces', line: lineOf(css, i) })
        depth = 0
      }
    }
    out.push(ch)
    i++
  }
  if (depth > 0)
    problems.push({ code: 'unclosed_brace', line: lineOf(css, openAt < 0 ? 0 : openAt) })
  return { bare: out.join(''), problems }
}

/**
 * Check a stylesheet. Errors are refusals; a document carrying one is never stored.
 *
 * The refusals, and why each one is a refusal rather than a warning:
 *
 * - **Bad syntax** — an unbalanced brace does not fail locally, it swallows every rule after
 *   it. docs/15 asks for a syntax check; this is it.
 * - **`</style`** — the block is inlined into a `<style>` element. This sequence closes it
 *   and the rest of the box becomes markup, which is how CSS turns into a script tag. The
 *   renderer strips it as well; refusing here means the operator is told rather than
 *   silently edited.
 * - **`@import`** — fetches a third-party stylesheet on every page load: a render-blocking
 *   request, the reader's IP handed to whoever hosts it, and the contents can change under
 *   the operator at any time. Self-host it instead. (docs/15 says the same about fonts:
 *   "never a font proxy".)
 * - **Off-origin `url()`** — the same IP leak without the stylesheet. Relative paths, `/`
 *   paths and `data:` URIs are fine, so anything in the media library still works.
 * - **`javascript:` / `expression(` / `-moz-binding`** — historical script-in-CSS vectors.
 *   Modern engines ignore them; refusing costs nothing and keeps an old browser honest.
 */
export const checkCustomCss = (css: string): CheckResult<CssProblemCode> => {
  const errors: Problem<CssProblemCode>[] = []
  const warnings: Problem<CssProblemCode>[] = []
  const hosts = new Set<string>()

  if (css.length > CSS_MAX_LENGTH) errors.push({ code: 'too_long', line: 1 })

  const { bare, problems } = scanCss(css)
  errors.push(...problems)

  // `</style` cannot be found on `bare` — a `"</style"` inside a string is blanked there, and
  // the HTML parser does not care that it was quoted.
  const styleClose = /<\/\s*style/i.exec(css)
  if (styleClose) errors.push({ code: 'style_escape', line: lineOf(css, styleClose.index) })

  for (const m of bare.matchAll(/@import\b/gi))
    errors.push({ code: 'import_rule', line: lineOf(css, m.index) })

  // url(...) — read from the original so the argument survives, located via `bare` so a
  // commented-out or quoted `url(` is not counted.
  for (const m of bare.matchAll(/\burl\(/gi)) {
    const start = (m.index ?? 0) + m[0].length
    const end = css.indexOf(')', start)
    const arg = css.slice(start, end === -1 ? css.length : end)
    const host = hostOf(arg)
    if (!host) continue
    hosts.add(host)
    errors.push({ code: 'remote_url', line: lineOf(css, m.index ?? 0), detail: host })
  }

  for (const m of bare.matchAll(/\b(expression\s*\(|-moz-binding)/gi))
    errors.push({ code: 'unsafe_value', line: lineOf(css, m.index ?? 0), detail: 'expression()' })
  for (const m of css.matchAll(/javascript\s*:/gi))
    errors.push({ code: 'unsafe_value', line: lineOf(css, m.index), detail: 'javascript:' })

  // Flagged, not refused. Both are legitimate (a sticky promo bar, a deliberate takeover
  // page) and both are how an operator accidentally covers the site with a transparent
  // layer. The way back is Appearance → Advanced itself, which these cannot reach.
  for (const m of bare.matchAll(/position\s*:\s*fixed/gi))
    warnings.push({ code: 'covers_viewport', line: lineOf(css, m.index ?? 0) })
  for (const m of bare.matchAll(/^\s*(?:html|body)\s*\{[^}]*display\s*:\s*none/gim))
    warnings.push({ code: 'hides_page', line: lineOf(css, m.index ?? 0) })

  return { errors, warnings, hosts: [...hosts].sort() }
}

/* ----------------------------------------------------------------------------- HTML */

/**
 * What a snippet may contain. Analytics and pixels need exactly this much: the loader
 * (`script`), the no-JS fallback every one of them ships (`noscript` wrapping an `img` or an
 * `iframe`), a preconnect (`link`), and a container to hang them on.
 *
 * Anything else is refused by name. Not because a `<form>` is dangerous in itself, but
 * because a snippet box that accepts arbitrary page structure is a second, unversioned CMS
 * with none of the checks the real one has — and because the tags an operator reaches for by
 * mistake (`meta`, `title`, `base`) do not work here at all and would fail silently.
 */
export const SNIPPET_ELEMENTS = [
  'script',
  'noscript',
  'iframe',
  'img',
  'link',
  'div',
  'span',
  'style',
  'template',
] as const

const VOID_ELEMENTS = new Set(['img', 'link', 'br', 'hr', 'meta', 'input', 'source', 'wbr'])

/**
 * Check a head / footer snippet.
 *
 * Tag balance is the load-bearing check: an unclosed `<div>` in the head slot swallows the
 * header, the page and the footer into itself, and the operator sees a blank site with no
 * error anywhere. `<script>` bodies are skipped while balancing, because `a < b` and
 * `'</div>'` inside JavaScript are not markup.
 */
export const checkSnippetHtml = (html: string): CheckResult<HtmlProblemCode> => {
  const errors: Problem<HtmlProblemCode>[] = []
  const warnings: Problem<HtmlProblemCode>[] = []
  const hosts = new Set<string>()
  const allowed = new Set<string>(SNIPPET_ELEMENTS)

  if (html.length > SNIPPET_MAX_LENGTH) errors.push({ code: 'too_long', line: 1 })

  // Comments are blanked, not removed, so every index still points at the original text —
  // and `<!-- Google tag (gtag.js) -->` around a snippet stops being read as markup. Vendors
  // ship those comments, and refusing a paste because of one would be indistinguishable from
  // the feature being broken.
  const bare = html.replace(/<!--[\s\S]*?(?:-->|$)/g, (c) => c.replace(/[^\n]/g, ' '))

  const stack: { name: string; index: number }[] = []
  const tag = /<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>?/g
  let m: RegExpExecArray | null = tag.exec(bare)
  while (m !== null) {
    const closing = m[1] === '/'
    const name = (m[2] as string).toLowerCase()
    const attrs = m[3] ?? ''
    const at = m.index

    if (name === 'meta') errors.push({ code: 'meta_tag', line: lineOf(html, at) })
    else if (!allowed.has(name))
      errors.push({ code: 'element_not_allowed', line: lineOf(html, at), detail: name })

    if (!closing) {
      for (const a of attrs.matchAll(/\b(?:src|href|data-src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi)) {
        const host = hostOf(a[1] as string)
        if (host && host !== 'http' && host !== 'https') hosts.add(host)
      }
      if (!VOID_ELEMENTS.has(name) && !attrs.trimEnd().endsWith('/'))
        stack.push({ name, index: at })
    } else {
      const openIndex = stack.map((s) => s.name).lastIndexOf(name)
      if (openIndex === -1)
        errors.push({ code: 'stray_close_tag', line: lineOf(html, at), detail: name })
      else {
        for (const orphan of stack.slice(openIndex + 1))
          errors.push({
            code: 'unbalanced_tags',
            line: lineOf(html, orphan.index),
            detail: orphan.name,
          })
        stack.length = openIndex
      }
    }

    // A <script> body is not markup: skip to its close tag so `if (a<b)` is not read as one.
    // Only when the tag actually opened one — `<script src=… />` is self-closing and never
    // went on the stack, and popping there would close somebody else's <div>.
    if (!closing && name === 'script' && stack.at(-1)?.name === 'script') {
      const close = /<\s*\/\s*script\s*>/i.exec(bare.slice(tag.lastIndex))
      if (close) {
        stack.pop()
        tag.lastIndex += close.index + close[0].length
      }
    }
    m = tag.exec(bare)
  }
  for (const orphan of stack)
    errors.push({ code: 'unbalanced_tags', line: lineOf(html, orphan.index), detail: orphan.name })

  for (const w of bare.matchAll(/document\s*\.\s*write\s*\(/g))
    warnings.push({ code: 'document_write', line: lineOf(html, w.index) })

  return { errors, warnings, hosts: [...hosts].sort() }
}

/* ------------------------------------------------------------------------ the refusal */

export interface AdvancedInput {
  css: string
  head_html: string
  footer_html: string
}

export interface AdvancedReview {
  css: CheckResult<CssProblemCode>
  head_html: CheckResult<HtmlProblemCode>
  footer_html: CheckResult<HtmlProblemCode>
  /** The first thing that makes this document unsaveable, or null when it may be stored. */
  refusal:
    | { kind: 'css'; field: 'css'; problem: Problem<CssProblemCode> }
    | { kind: 'html'; field: 'head_html' | 'footer_html'; problem: Problem<HtmlProblemCode> }
    | null
  /** Every off-origin host the document would make a reader's browser call. */
  hosts: string[]
}

/**
 * The whole verdict on one submitted document, in one pure function.
 *
 * The API route and the screen both go through this rather than assembling the three checks
 * themselves, so "what gets refused" has exactly one definition and a test can hold it
 * without a database, a session or a request. `refusal !== null` is the store's answer: a
 * document that carries one is never written, and so can never be rendered.
 */
export const reviewAdvanced = (input: AdvancedInput): AdvancedReview => {
  const css = checkCustomCss(input.css)
  const head = checkSnippetHtml(input.head_html)
  const footer = checkSnippetHtml(input.footer_html)
  const cssError = css.errors[0]
  const headError = head.errors[0]
  const footerError = footer.errors[0]
  const refusal: AdvancedReview['refusal'] = cssError
    ? { kind: 'css', field: 'css', problem: cssError }
    : headError
      ? { kind: 'html', field: 'head_html', problem: headError }
      : footerError
        ? { kind: 'html', field: 'footer_html', problem: footerError }
        : null
  return {
    css,
    head_html: head,
    footer_html: footer,
    refusal,
    hosts: [...new Set([...css.hosts, ...head.hosts, ...footer.hosts])].sort(),
  }
}

/* ------------------------------------------------------------------------- rendering */

/**
 * Last line before the browser. The validator has already refused `</style`, but a row can
 * predate a rule, be restored from a backup, or be written by hand in psql — and the cost of
 * being wrong here is a script tag on every page, so the renderer never trusts the store.
 */
export const cssForStyleTag = (css: string): string => css.replace(/<\/\s*style/gi, '')
