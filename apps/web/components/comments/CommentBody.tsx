import type { BlockNode, CommentBody as Body, InlineNode } from '@palscans/core/comments'
import { safeHref } from '@palscans/core/comments'
import { messages } from '@palscans/core/messages'
import { Images } from 'lucide-react'
import type { ReactNode } from 'react'
import type { CommentImage } from '@/lib/comments/types'
import { Spoiler } from './Spoiler'

/**
 * Renders a structured body by walking the closed node union (docs/14 "Rendering"): no HTML
 * in the database, no sanitiser on the read path. Links are `rel="nofollow ugc"` always.
 */
function Inline({ nodes }: { nodes: readonly InlineNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        const key = `${n.type}-${i}`
        switch (n.type) {
          case 'text': {
            let el: ReactNode = n.text
            for (const m of n.marks ?? []) {
              if (m === 'bold') el = <strong className="font-bold">{el}</strong>
              else if (m === 'italic') el = <em>{el}</em>
              else if (m === 'strike') el = <s>{el}</s>
              else if (m === 'code')
                el = <code className="rounded-sm bg-surface-3 px-1 text-[13px]">{el}</code>
            }
            return <span key={key}>{el}</span>
          }
          case 'hard_break':
            return <br key={key} />
          case 'spoiler':
            return (
              <Spoiler key={key}>
                <Inline nodes={n.children} />
              </Spoiler>
            )
          case 'mention':
            return (
              <a
                key={key}
                href={`/u/${encodeURIComponent(n.username)}`}
                className="font-semibold text-brand-hover hover:text-fg"
              >
                @{n.username}
              </a>
            )
          case 'link': {
            const href = safeHref(n.href)
            const label = n.children.length ? <Inline nodes={n.children} /> : n.href
            if (!href) return <span key={key}>{label}</span>
            return (
              <a
                key={key}
                href={href}
                rel="nofollow ugc noopener"
                target="_blank"
                className="text-brand-hover underline decoration-brand/40 underline-offset-2 hover:text-fg"
              >
                {label}
              </a>
            )
          }
          default:
            return null
        }
      })}
    </>
  )
}

function Block({ node, image }: { node: BlockNode; image: CommentImage | null }) {
  switch (node.type) {
    case 'paragraph':
      return (
        <p className="m-0 text-sm leading-[21px] [&+p]:mt-1.5">
          <Inline nodes={node.children} />
        </p>
      )
    case 'quote':
      return (
        <blockquote className="my-1 border-l-2 border-line pl-3 text-fg-muted">
          {node.username ? (
            <cite className="block text-[12px] not-italic">@{node.username}</cite>
          ) : null}
          {node.children.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static tree, never reordered
            <Block key={i} node={c} image={image} />
          ))}
        </blockquote>
      )
    case 'image':
      return image && image.id === node.imageId ? <CommentImageFigure image={image} /> : null
  }
}

export function CommentImageFigure({ image }: { image: CommentImage }) {
  const w = Math.min(image.width, 240)
  const h = Math.round((w / image.width) * image.height)
  return (
    <span className="relative mt-1.5 block w-fit overflow-hidden rounded-md border border-line bg-surface-2">
      <img
        src={image.src}
        alt=""
        width={w}
        height={h}
        loading="lazy"
        decoding="async"
        className="block h-auto max-w-full"
      />
      <span className="absolute bottom-1.5 left-2 inline-flex items-center gap-1 text-[10px] font-semibold tracking-[0.04em] text-fg-muted">
        <Images size={10} aria-hidden="true" />
        {messages.commentThread.collection}
      </span>
    </span>
  )
}

export function CommentBody({
  body,
  image,
  deleted,
}: {
  body: Body
  image: CommentImage | null
  deleted: boolean
}) {
  if (deleted)
    return (
      <p className="m-0 text-sm italic leading-[21px] text-fg-subtle">
        {messages.comments.deleted}
      </p>
    )
  const hasImageBlock = body.children.some((b) => b.type === 'image')
  return (
    <div className="mt-[3px] min-w-0 break-words text-fg">
      {body.children.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static tree, never reordered
        <Block key={i} node={b} image={image} />
      ))}
      {!hasImageBlock && image ? <CommentImageFigure image={image} /> : null}
    </div>
  )
}
