import type { CommentNode, InlineNode, Mark } from './body.js'

export interface RenderOptions {
  /** Resolve a community image id to a URL and dimensions; unknown ids render nothing. */
  imageUrl?: (imageId: number) => { src: string; width: number; height: number } | null
  /** Profile URL for a mention; default `/u/<username>`. */
  mentionHref?: (username: string) => string
  /** CSS class prefix, default `c-`. */
  classPrefix?: string
}

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c)

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

const MARK_TAG: Record<Mark, string> = { bold: 'strong', italic: 'em', strike: 's', code: 'code' }

/**
 * Render a comment body to an HTML string. Every text node is escaped, every attribute
 * value is escaped, links are `rel="nofollow ugc noopener"` always (docs/14 §9).
 */
export const renderHtml = (node: CommentNode, opts: RenderOptions = {}): string => {
  const px = opts.classPrefix ?? 'c-'
  const mentionHref = opts.mentionHref ?? ((u: string) => `/u/${encodeURIComponent(u)}`)

  const inline = (n: InlineNode): string => {
    switch (n.type) {
      case 'text': {
        let html = escapeHtml(n.text)
        for (const m of n.marks ?? []) html = `<${MARK_TAG[m]}>${html}</${MARK_TAG[m]}>`
        return html
      }
      case 'hard_break':
        return '<br>'
      case 'spoiler':
        return `<span class="${px}spoiler" data-spoiler>${n.children.map(inline).join('')}</span>`
      case 'mention':
        return `<a class="${px}mention" href="${escapeHtml(mentionHref(n.username))}">@${escapeHtml(n.username)}</a>`
      case 'link': {
        const href = safeHref(n.href)
        const inner = n.children.map(inline).join('') || escapeHtml(n.href)
        if (!href) return inner
        return `<a class="${px}link" href="${escapeHtml(href)}" rel="nofollow ugc noopener" target="_blank">${inner}</a>`
      }
    }
  }

  const block = (n: CommentNode): string => {
    switch (n.type) {
      case 'doc':
        return n.children.map(block).join('')
      case 'paragraph':
        return `<p>${n.children.map(inline).join('')}</p>`
      case 'quote': {
        const cite = n.username ? `<cite>@${escapeHtml(n.username)}</cite>` : ''
        const id = n.commentId ? ` data-comment-id="${n.commentId}"` : ''
        return `<blockquote class="${px}quote"${id}>${cite}${n.children.map(block).join('')}</blockquote>`
      }
      case 'image': {
        const img = opts.imageUrl?.(n.imageId)
        if (!img) return ''
        return `<img class="${px}image" src="${escapeHtml(img.src)}" width="${img.width}" height="${img.height}" alt="${escapeHtml(n.alt ?? '')}" loading="lazy">`
      }
      default:
        return inline(n)
    }
  }

  return block(node)
}
