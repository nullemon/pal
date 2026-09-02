import { cn } from '@palscans/ui'
import type { ReactNode } from 'react'

/**
 * Renders the structured rich text stored in `genres.intro`, `announcements.body` and
 * `series.seo_text` (docs/12 §3: JSON in, semantic HTML out, never raw HTML). Unknown node
 * types render nothing; text is always escaped by React.
 */
export type RichTextDoc = { type: 'doc'; children: readonly unknown[] }

type Mark = 'bold' | 'italic' | 'strike' | 'code'
const MARKS: readonly Mark[] = ['bold', 'italic', 'strike', 'code']

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const children = (n: Record<string, unknown>): unknown[] =>
  Array.isArray(n.children) ? n.children : []

const safeHref = (href: unknown): string | null => {
  if (typeof href !== 'string') return null
  const trimmed = href.trim()
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

function renderText(n: Record<string, unknown>, key: number): ReactNode {
  const text = typeof n.text === 'string' ? n.text : ''
  const marks = Array.isArray(n.marks)
    ? n.marks.filter((m): m is Mark => MARKS.includes(m as Mark))
    : []
  let out: ReactNode = text
  for (const m of marks) {
    if (m === 'bold') out = <strong>{out}</strong>
    else if (m === 'italic') out = <em>{out}</em>
    else if (m === 'strike') out = <s>{out}</s>
    else out = <code className="rounded-sm bg-surface-2 px-1 text-[0.9em]">{out}</code>
  }
  return <span key={key}>{out}</span>
}

function renderNode(node: unknown, key: number): ReactNode {
  if (!isRecord(node) || typeof node.type !== 'string') return null
  const kids = () => children(node).map(renderNode)
  switch (node.type) {
    case 'doc':
      return <div key={key}>{kids()}</div>
    case 'paragraph':
      return <p key={key}>{kids()}</p>
    case 'heading': {
      const level = typeof node.level === 'number' ? Math.min(4, Math.max(2, node.level)) : 2
      const Tag = `h${level}` as 'h2' | 'h3' | 'h4'
      return <Tag key={key}>{kids()}</Tag>
    }
    case 'bullet_list':
    case 'bulletList':
      return <ul key={key}>{kids()}</ul>
    case 'ordered_list':
    case 'orderedList':
      return <ol key={key}>{kids()}</ol>
    case 'list_item':
    case 'listItem':
      return <li key={key}>{kids()}</li>
    case 'quote':
    case 'blockquote':
      return <blockquote key={key}>{kids()}</blockquote>
    case 'hard_break':
      return <br key={key} />
    case 'text':
      return renderText(node, key)
    case 'spoiler':
      return <span key={key}>{kids()}</span>
    case 'mention':
      return <span key={key}>@{typeof node.username === 'string' ? node.username : ''}</span>
    case 'link': {
      const href = safeHref(node.href)
      if (!href) return <span key={key}>{kids()}</span>
      const external = /^https?:/i.test(href)
      return (
        <a
          key={key}
          href={href}
          className="text-brand-hover underline-offset-2 hover:underline"
          {...(external ? { rel: 'noopener', target: '_blank' } : {})}
        >
          {kids()}
        </a>
      )
    }
    default:
      return null
  }
}

/** Plain text of a document, for descriptions and the `{intro:160}` template variable. */
export function richTextToPlain(doc: unknown): string {
  const walk = (node: unknown): string => {
    if (!isRecord(node)) return ''
    if (node.type === 'text') return typeof node.text === 'string' ? node.text : ''
    if (node.type === 'hard_break') return '\n'
    const inner = children(node).map(walk).join('')
    return node.type === 'paragraph' || node.type === 'heading' || node.type === 'list_item'
      ? `${inner}\n`
      : inner
  }
  return walk(doc).replace(/\s+/g, ' ').trim()
}

export function RichText({ doc, className }: { doc: unknown; className?: string }) {
  if (!isRecord(doc) || doc.type !== 'doc') return null
  return (
    <div
      className={cn(
        'flex flex-col gap-3 text-[15px] leading-relaxed text-fg-muted [&_h2]:text-[17px] [&_h2]:font-extrabold [&_h2]:text-fg [&_h3]:text-[15px] [&_h3]:font-bold [&_h3]:text-fg [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3',
        className,
      )}
    >
      {children(doc).map(renderNode)}
    </div>
  )
}
