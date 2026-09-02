/**
 * WordPress stores comments as HTML; the new schema stores the structured JSON body from
 * `comments/body.ts` (docs/09: "convert stored HTML to the structured JSON body"). This is a
 * deliberately narrow converter: paragraphs, hard breaks, links, and the four inline marks.
 * Anything else is flattened to text — a legacy comment is not worth an HTML parser, and
 * nothing unknown may reach the renderer.
 */
import type { BlockNode, CommentBody, InlineNode, Mark } from '../comments/body.js'
import { decodeEntities } from './chapter-number.js'

const MARK_TAGS: Record<string, Mark> = {
  b: 'bold',
  strong: 'bold',
  i: 'italic',
  em: 'italic',
  s: 'strike',
  strike: 'strike',
  del: 'strike',
  code: 'code',
}

const TOKEN_RE = /<\/?([a-z0-9]+)([^>]*)>/gi
const HREF_RE = /href\s*=\s*["']([^"']+)["']/i

const pushText = (into: InlineNode[], text: string, marks: Mark[], href: string | null): void => {
  const value = decodeEntities(text).replace(/[ \t\r\n]+/g, ' ')
  if (value.trim() === '') return
  const node: InlineNode =
    marks.length > 0
      ? { type: 'text', text: value, marks: [...marks] }
      : { type: 'text', text: value }
  if (href === null) {
    into.push(node)
    return
  }
  const last = into[into.length - 1]
  if (last && last.type === 'link' && last.href === href) {
    into[into.length - 1] = { type: 'link', href, children: [...last.children, node] }
    return
  }
  into.push({ type: 'link', href, children: [node] })
}

/** Convert one legacy comment's HTML into the stored JSON body. Never throws. */
export const htmlToCommentBody = (html: string): CommentBody => {
  const blocks: BlockNode[] = []
  let inline: InlineNode[] = []
  const marks: Mark[] = []
  let href: string | null = null

  const endParagraph = (): void => {
    while (inline.length > 0 && inline[inline.length - 1]?.type === 'hard_break') inline.pop()
    if (inline.length > 0) blocks.push({ type: 'paragraph', children: inline })
    inline = []
  }

  let cursor = 0
  TOKEN_RE.lastIndex = 0
  for (let m = TOKEN_RE.exec(html); m !== null; m = TOKEN_RE.exec(html)) {
    pushText(inline, html.slice(cursor, m.index), marks, href)
    cursor = m.index + m[0].length
    const tag = (m[1] ?? '').toLowerCase()
    const closing = m[0].startsWith('</')
    if (tag === 'p' || tag === 'div' || tag === 'blockquote') {
      endParagraph()
    } else if (tag === 'br') {
      if (inline.length > 0) inline.push({ type: 'hard_break' })
    } else if (tag === 'a') {
      if (closing) href = null
      else {
        const found = HREF_RE.exec(m[2] ?? '')
        const url = found?.[1] ?? ''
        href = /^https?:\/\//i.test(url) ? decodeEntities(url) : null
      }
    } else if (MARK_TAGS[tag]) {
      const mark = MARK_TAGS[tag] as Mark
      if (closing) {
        const at = marks.lastIndexOf(mark)
        if (at >= 0) marks.splice(at, 1)
      } else marks.push(mark)
    }
  }
  pushText(inline, html.slice(cursor), marks, href)
  endParagraph()

  return { type: 'doc', version: 1, children: blocks }
}
