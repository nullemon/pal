import type {
  BlockNode,
  CommentBody,
  InlineNode,
  Mark,
  ParagraphNode,
} from '@palscans/core/comments'

/**
 * The composer's lightweight markup ⇄ structured body (docs/14 §1). The client keeps a
 * plain textarea (it works everywhere, including on phones) and turns `**bold**`,
 * `*italic*`, `~~strike~~`, `||spoiler||`, `@mention` and bare URLs into nodes on submit;
 * editing converts the stored body back. No HTML is ever produced here.
 */

const DELIMS: ReadonlyArray<readonly [string, Mark]> = [
  ['**', 'bold'],
  ['~~', 'strike'],
  ['*', 'italic'],
]

const MENTION_RE = /^@([A-Za-z0-9_.]{2,32})(?![A-Za-z0-9_])/
const URL_RE = /^(?:https?:\/\/|www\.)[^\s<>"'`]+/i
const TRAILING_PUNCT = /[.,;:!?)\]]+$/

const hasClose = (text: string, delim: string, from: number): boolean => {
  const idx = text.indexOf(delim, from)
  return idx > from
}

export const parseInline = (text: string, inherited: readonly Mark[] = []): InlineNode[] => {
  const out: InlineNode[] = []
  const marks: Mark[] = [...inherited]
  let buf = ''
  const flush = () => {
    if (!buf) return
    out.push(
      marks.length ? { type: 'text', text: buf, marks: [...marks] } : { type: 'text', text: buf },
    )
    buf = ''
  }

  let i = 0
  outer: while (i < text.length) {
    const ch = text[i] as string

    if (ch === '\n') {
      flush()
      out.push({ type: 'hard_break' })
      i++
      continue
    }

    if (text.startsWith('||', i)) {
      const close = text.indexOf('||', i + 2)
      if (close > i + 2) {
        flush()
        out.push({ type: 'spoiler', children: parseInline(text.slice(i + 2, close), marks) })
        i = close + 2
        continue
      }
    }

    for (const [delim, mark] of DELIMS) {
      if (!text.startsWith(delim, i)) continue
      // A single `*` inside `**` is handled by the longer delimiter first.
      if (delim === '*' && text.startsWith('**', i)) continue
      const open = marks.indexOf(mark)
      if (open >= 0) {
        flush()
        marks.splice(open, 1)
        i += delim.length
        continue outer
      }
      if (hasClose(text, delim, i + delim.length) && !/\s/.test(text[i + delim.length] ?? ' ')) {
        flush()
        marks.push(mark)
        i += delim.length
        continue outer
      }
    }

    if (ch === '@' && (i === 0 || /[\s([]/.test(text[i - 1] ?? ''))) {
      const m = MENTION_RE.exec(text.slice(i))
      if (m?.[1]) {
        flush()
        out.push({ type: 'mention', username: m[1] })
        i += m[0].length
        continue
      }
    }

    if (
      (ch === 'h' || ch === 'H' || ch === 'w' || ch === 'W') &&
      (i === 0 || /\s/.test(text[i - 1] ?? ''))
    ) {
      const m = URL_RE.exec(text.slice(i))
      if (m) {
        const raw = m[0].replace(TRAILING_PUNCT, '')
        flush()
        const href = /^www\./i.test(raw) ? `https://${raw}` : raw
        out.push({ type: 'link', href, children: [{ type: 'text', text: raw }] })
        i += raw.length
        continue
      }
    }

    buf += ch
    i++
  }
  flush()
  return out
}

export interface ParseMarkupOptions {
  /** A community image attached from the picker, appended as an image block. */
  imageId?: number | null
}

/** Textarea contents → structured body. Paragraphs split on blank lines. */
export const parseMarkup = (text: string, opts: ParseMarkupOptions = {}): CommentBody => {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/^\n+|\n+$/g, ''))
    .filter((p) => p.trim().length > 0)
  const children: BlockNode[] = paragraphs.map(
    (p): ParagraphNode => ({ type: 'paragraph', children: parseInline(p) }),
  )
  if (opts.imageId) children.push({ type: 'image', imageId: opts.imageId })
  return { type: 'doc', version: 1, children }
}

const wrap = (text: string, marks: readonly Mark[] | undefined): string => {
  let s = text
  for (const m of marks ?? []) {
    if (m === 'bold') s = `**${s}**`
    else if (m === 'italic') s = `*${s}*`
    else if (m === 'strike') s = `~~${s}~~`
    else if (m === 'code') s = `\`${s}\``
  }
  return s
}

const inlineToMarkup = (nodes: readonly InlineNode[]): string =>
  nodes
    .map((n) => {
      switch (n.type) {
        case 'text':
          return wrap(n.text, n.marks)
        case 'hard_break':
          return '\n'
        case 'spoiler':
          return `||${inlineToMarkup(n.children)}||`
        case 'mention':
          return `@${n.username}`
        case 'link': {
          const label = inlineToMarkup(n.children)
          return label && label !== n.href ? `${label} (${n.href})` : n.href
        }
        default:
          return ''
      }
    })
    .join('')

export interface MarkupFromBody {
  text: string
  imageId: number | null
}

/** Stored body → editable text (+ the attached image id, if any). */
export const bodyToMarkup = (body: CommentBody): MarkupFromBody => {
  let imageId: number | null = null
  const blocks: string[] = []
  const walk = (node: BlockNode): void => {
    switch (node.type) {
      case 'paragraph':
        blocks.push(inlineToMarkup(node.children))
        break
      case 'quote':
        for (const c of node.children) walk(c)
        break
      case 'image':
        imageId ??= node.imageId
        break
    }
  }
  for (const b of body.children) walk(b)
  return { text: blocks.join('\n\n'), imageId }
}
