/**
 * The bridge between what an operator types and what the site renders.
 *
 * `announcements.body` and `pages.body` are structured JSON (docs/12 §3: "JSON in, semantic
 * HTML out, never raw HTML") — the exact shape `components/discovery/RichText.tsx` walks.
 * Storing HTML would mean sanitising it; instead the editor speaks a small Markdown subset
 * covering every node that renderer knows about, and this module converts both ways so an
 * existing document can be loaded, edited and written back without loss.
 *
 * Supported: `##`/`###`/`####` headings, `-` bullets, `1.` numbered lists, `>` quotes,
 * blank-line paragraphs, single newline as a line break, `**bold**`, `_italic_`,
 * `~~strike~~`, `` `code` `` and `[text](href)`. Anything else is literal text.
 */

export type RichMark = 'bold' | 'italic' | 'strike' | 'code'

export interface RichTextNode {
  type: 'text'
  text: string
  marks?: readonly RichMark[]
}
export interface RichBreakNode {
  type: 'hard_break'
}
export interface RichLinkNode {
  type: 'link'
  href: string
  children: readonly RichInline[]
}
export type RichInline = RichTextNode | RichBreakNode | RichLinkNode

export interface RichParagraph {
  type: 'paragraph'
  children: readonly RichInline[]
}
export interface RichHeading {
  type: 'heading'
  level: 2 | 3 | 4
  children: readonly RichInline[]
}
export interface RichListItem {
  type: 'list_item'
  children: readonly RichInline[]
}
export interface RichList {
  type: 'bullet_list' | 'ordered_list'
  children: readonly RichListItem[]
}
export interface RichQuote {
  type: 'quote'
  children: readonly RichParagraph[]
}
export type RichBlock = RichParagraph | RichHeading | RichList | RichQuote

export interface RichDoc {
  type: 'doc'
  version: 1
  children: readonly RichBlock[]
}

export const EMPTY_DOC: RichDoc = { type: 'doc', version: 1, children: [] }

const MARK_ORDER: readonly RichMark[] = ['code', 'italic', 'bold', 'strike']

// ---------------------------------------------------------------------------- markdown → doc

/** Escape sequences and the four inline constructs, longest delimiters first. */
const INLINE =
  /\\([\\`*_~[\]#>.-])|`([^`\n]+)`|\[([^\]\n]*)\]\(([^)\s]*)\)|\*\*([\s\S]+?)\*\*|~~([\s\S]+?)~~|\*([^*\n]+)\*|_([^_\n]+)_/g

const withMark = (marks: readonly RichMark[], mark: RichMark): readonly RichMark[] =>
  marks.includes(mark) ? marks : [...marks, mark]

const sameMarks = (a: readonly RichMark[], b: readonly RichMark[]): boolean =>
  a.length === b.length && a.every((m) => b.includes(m))

const pushText = (out: RichInline[], text: string, marks: readonly RichMark[]): void => {
  if (!text) return
  const last = out[out.length - 1]
  if (last && last.type === 'text' && sameMarks(last.marks ?? [], marks)) {
    out[out.length - 1] = {
      type: 'text',
      text: last.text + text,
      ...(marks.length ? { marks } : {}),
    }
    return
  }
  out.push({ type: 'text', text, ...(marks.length ? { marks } : {}) })
}

/**
 * A link target the renderer will actually keep: site-relative, or http(s). Anything else
 * (`javascript:`, `data:`, protocol-relative) is dropped and the label stays as plain text —
 * mirroring `safeHref` in RichText.tsx so the editor cannot promise a link the site drops.
 */
export const safeLinkHref = (href: string): string | null => {
  const trimmed = href.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).href
    } catch {
      return null
    }
  }
  return null
}

const parseInline = (source: string, marks: readonly RichMark[] = []): RichInline[] => {
  const out: RichInline[] = []
  let cursor = 0
  INLINE.lastIndex = 0
  for (let m = INLINE.exec(source); m; m = INLINE.exec(source)) {
    pushText(out, source.slice(cursor, m.index), marks)
    cursor = m.index + m[0].length
    const [, escaped, code, label, href, bold, strike, starItalic, underItalic] = m
    if (escaped !== undefined) pushText(out, escaped, marks)
    else if (code !== undefined) pushText(out, code, withMark(marks, 'code'))
    else if (href !== undefined) {
      const safe = safeLinkHref(href)
      const children = parseInline(label ?? '', marks)
      if (safe && children.length) out.push({ type: 'link', href: safe, children })
      else for (const child of children) out.push(child)
    } else if (bold !== undefined) {
      for (const child of parseInline(bold, withMark(marks, 'bold'))) out.push(child)
    } else if (strike !== undefined) {
      for (const child of parseInline(strike, withMark(marks, 'strike'))) out.push(child)
    } else {
      const italic = starItalic ?? underItalic ?? ''
      for (const child of parseInline(italic, withMark(marks, 'italic'))) out.push(child)
    }
    // The recursive calls above share this regex and reset its `lastIndex`; restore it.
    INLINE.lastIndex = cursor
  }
  pushText(out, source.slice(cursor), marks)
  return out
}

/** Paragraph text: single newlines become `hard_break`, as the renderer expects. */
const paragraphFrom = (lines: readonly string[]): RichParagraph => {
  const children: RichInline[] = []
  lines.forEach((line, i) => {
    if (i > 0) children.push({ type: 'hard_break' })
    for (const node of parseInline(line)) children.push(node)
  })
  return { type: 'paragraph', children }
}

const HEADING = /^(#{1,6})\s+(.*)$/
const BULLET = /^[-*]\s+(.*)$/
const ORDERED = /^\d+[.)]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/

export const markdownToDoc = (markdown: string): RichDoc => {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: RichBlock[] = []
  let paragraph: string[] = []
  let list: { type: 'bullet_list' | 'ordered_list'; items: string[] } | null = null
  let quote: string[] = []

  const flushParagraph = () => {
    if (paragraph.length) blocks.push(paragraphFrom(paragraph))
    paragraph = []
  }
  const flushList = () => {
    if (list?.items.length)
      blocks.push({
        type: list.type,
        children: list.items.map((text) => ({
          type: 'list_item' as const,
          children: parseInline(text),
        })),
      })
    list = null
  }
  const flushQuote = () => {
    if (quote.length) {
      const paragraphs: RichParagraph[] = []
      let buffer: string[] = []
      for (const line of quote) {
        if (line.trim()) buffer.push(line)
        else if (buffer.length) {
          paragraphs.push(paragraphFrom(buffer))
          buffer = []
        }
      }
      if (buffer.length) paragraphs.push(paragraphFrom(buffer))
      if (paragraphs.length) blocks.push({ type: 'quote', children: paragraphs })
    }
    quote = []
  }
  const flushAll = () => {
    flushParagraph()
    flushList()
    flushQuote()
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) {
      flushAll()
      continue
    }
    const heading = HEADING.exec(line)
    if (heading?.[1] && heading[2] !== undefined) {
      flushAll()
      const level = Math.min(4, Math.max(2, heading[1].length)) as 2 | 3 | 4
      blocks.push({ type: 'heading', level, children: parseInline(heading[2]) })
      continue
    }
    const quoted = QUOTE.exec(line)
    if (quoted) {
      flushParagraph()
      flushList()
      quote.push(quoted[1] ?? '')
      continue
    }
    const bullet = BULLET.exec(line)
    const ordered = bullet ? null : ORDERED.exec(line)
    if (bullet || ordered) {
      flushParagraph()
      flushQuote()
      const type = bullet ? 'bullet_list' : 'ordered_list'
      if (list && list.type !== type) flushList()
      if (!list) list = { type, items: [] }
      list.items.push((bullet?.[1] ?? ordered?.[1] ?? '').trim())
      continue
    }
    flushList()
    flushQuote()
    paragraph.push(line)
  }
  flushAll()
  return { type: 'doc', version: 1, children: blocks }
}

// ---------------------------------------------------------------------------- doc → markdown

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const kidsOf = (node: Record<string, unknown>): unknown[] =>
  Array.isArray(node.children) ? node.children : []

const ESCAPE_INLINE = /[\\`*_~[\]]/g
/**
 * A line that would otherwise be read back as a heading, quote, bullet or numbered item.
 *
 * The trailing whitespace requirement matters and is not cosmetic: `HEADING`, `BULLET` and
 * `ORDERED` above all demand `\s+` after the marker, so a paragraph beginning `**bold**`
 * is not a bullet — but escaping it as though it were produced `\**bold**`, which reads
 * back as a literal `*` wrapping *italic* text. Every document whose body opened with bold
 * lost that bold the first time it was reopened and saved. `>` needs no whitespace because
 * `QUOTE` does not require any.
 */
const ESCAPE_LINE_START = /^(\s*)((?:#{1,6}|[-*]|\d+[.)])(?=\s)|>)/

const escapeText = (text: string): string => text.replace(ESCAPE_INLINE, '\\$&')

const escapeLineStarts = (block: string): string =>
  block
    .split('\n')
    .map((line) =>
      line.replace(ESCAPE_LINE_START, (_m, space: string, marker: string) => {
        const last = marker.length - 1
        return `${space}${marker.slice(0, last)}\\${marker.slice(last)}`
      }),
    )
    .join('\n')

const wrapMarks = (text: string, marks: readonly RichMark[]): string => {
  let out = text
  for (const mark of MARK_ORDER) {
    if (!marks.includes(mark)) continue
    if (mark === 'code') out = `\`${out}\``
    else if (mark === 'italic') out = `_${out}_`
    else if (mark === 'bold') out = `**${out}**`
    else out = `~~${out}~~`
  }
  return out
}

const inlineToMarkdown = (node: unknown): string => {
  if (!isRecord(node)) return ''
  switch (node.type) {
    case 'text': {
      const text = typeof node.text === 'string' ? node.text : ''
      const marks = Array.isArray(node.marks)
        ? node.marks.filter((m): m is RichMark => MARK_ORDER.includes(m as RichMark))
        : []
      // Code spans are literal — an escape inside one would be typed back out verbatim.
      return wrapMarks(marks.includes('code') ? text : escapeText(text), marks)
    }
    case 'hard_break':
      return '\n'
    case 'link': {
      const label = kidsOf(node).map(inlineToMarkdown).join('')
      const href = typeof node.href === 'string' ? node.href : ''
      return href ? `[${label}](${href})` : label
    }
    case 'mention':
      return `@${typeof node.username === 'string' ? node.username : ''}`
    default:
      // `spoiler` and anything else the renderer collapses to its children
      return kidsOf(node).map(inlineToMarkdown).join('')
  }
}

/** A list item may hold inline nodes directly or wrap them in a paragraph. */
const listItemToMarkdown = (item: unknown): string => {
  if (!isRecord(item)) return ''
  const kids = kidsOf(item)
  if (kids.some((k) => isRecord(k) && (k.type === 'paragraph' || k.type === 'heading')))
    return kids.map((k) => (isRecord(k) ? kidsOf(k).map(inlineToMarkdown).join('') : '')).join(' ')
  return kids.map(inlineToMarkdown).join('')
}

const blockToMarkdown = (node: unknown): string => {
  if (!isRecord(node)) return ''
  const inline = () => kidsOf(node).map(inlineToMarkdown).join('')
  switch (node.type) {
    case 'heading': {
      const level = typeof node.level === 'number' ? Math.min(4, Math.max(2, node.level)) : 2
      return `${'#'.repeat(level)} ${inline()}`
    }
    case 'bullet_list':
    case 'bulletList':
      return kidsOf(node)
        .map((item) => `- ${escapeLineStarts(listItemToMarkdown(item))}`)
        .join('\n')
    case 'ordered_list':
    case 'orderedList':
      return kidsOf(node)
        .map((item, i) => `${i + 1}. ${escapeLineStarts(listItemToMarkdown(item))}`)
        .join('\n')
    case 'quote':
    case 'blockquote':
      return kidsOf(node)
        .map(blockToMarkdown)
        .join('\n\n')
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n')
    default:
      return escapeLineStarts(inline())
  }
}

/** Round-trips `markdownToDoc`; also loads documents written by the seed or an older editor. */
export const docToMarkdown = (doc: unknown): string => {
  if (!isRecord(doc) || doc.type !== 'doc') return ''
  return kidsOf(doc)
    .map(blockToMarkdown)
    .filter((block) => block.length > 0)
    .join('\n\n')
}

/** Plain text of a document — the excerpt fallback and the "is it empty" check. */
export const docToPlain = (node: unknown): string => {
  if (!isRecord(node)) return ''
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : ''
  if (node.type === 'hard_break') return '\n'
  const inner = kidsOf(node).map(docToPlain).join('')
  return node.type === 'paragraph' || node.type === 'heading' || node.type === 'list_item'
    ? `${inner}\n`
    : inner
}

/** True when the document carries no visible text (an empty body is refused on save). */
export const isDocEmpty = (doc: unknown): boolean => docToPlain(doc).trim().length === 0

/** First ~200 characters of prose, for the announcement excerpt fallback. */
export const excerptFrom = (doc: unknown, max = 200): string => {
  const text = docToPlain(doc).replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}
