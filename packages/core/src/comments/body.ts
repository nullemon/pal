import { z } from 'zod'
import { messages } from '../messages.js'
import { safeHref } from './render.js'

/**
 * Structured comment bodies (docs/02 "Comments", docs/14 §1).
 * Stored as JSON, rendered by walking this closed union — never HTML in the database.
 */
export interface TextNode {
  type: 'text'
  text: string
  marks?: readonly Mark[]
}
export type Mark = 'bold' | 'italic' | 'strike' | 'code'

export interface SpoilerNode {
  type: 'spoiler'
  children: readonly InlineNode[]
}
export interface LinkNode {
  type: 'link'
  href: string
  children: readonly InlineNode[]
}
export interface MentionNode {
  type: 'mention'
  username: string
  userId?: number
}
export interface HardBreakNode {
  type: 'hard_break'
}
export type InlineNode = TextNode | SpoilerNode | LinkNode | MentionNode | HardBreakNode

export interface ParagraphNode {
  type: 'paragraph'
  children: readonly InlineNode[]
}
export interface QuoteNode {
  type: 'quote'
  /** The quoted comment id and author, for reply-to-reply quoting. */
  commentId?: number
  username?: string
  children: readonly BlockNode[]
}
export interface ImageNode {
  type: 'image'
  /** community_images.id */
  imageId: number
  alt?: string
}
export type BlockNode = ParagraphNode | QuoteNode | ImageNode

export interface CommentBody {
  type: 'doc'
  version: 1
  children: readonly BlockNode[]
}

export type CommentNode = CommentBody | BlockNode | InlineNode

export const COMMENT_MAX_CHARS = 2000
export const COMMENT_MAX_MENTIONS = 5
/** Structural caps: a body is bounded in width and depth, not only in plain-text length. */
export const COMMENT_MAX_BLOCKS = 50
export const COMMENT_MAX_INLINE = 200
export const COMMENT_MAX_QUOTE_DEPTH = 2
export const COMMENT_MAX_INLINE_DEPTH = 4
export const COMMENT_MAX_HREF = 2048
export const COMMENT_MAX_USERNAME = 32

const markSchema = z.enum(['bold', 'italic', 'strike', 'code'])

export const inlineNodeSchema: z.ZodType<InlineNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('text'),
      text: z.string().max(COMMENT_MAX_CHARS),
      marks: z.array(markSchema).max(4).optional(),
    }),
    z.object({
      type: z.literal('spoiler'),
      children: z.array(inlineNodeSchema).max(COMMENT_MAX_INLINE),
    }),
    z.object({
      type: z.literal('link'),
      href: z
        .string()
        .max(COMMENT_MAX_HREF)
        .refine((h) => safeHref(h) !== null, messages.commentThread.linkScheme),
      children: z.array(inlineNodeSchema).max(COMMENT_MAX_INLINE),
    }),
    z.object({
      type: z.literal('mention'),
      username: z.string().max(COMMENT_MAX_USERNAME),
      userId: z.number().int().optional(),
    }),
    z.object({ type: z.literal('hard_break') }),
  ]),
)

export const blockNodeSchema: z.ZodType<BlockNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('paragraph'),
      children: z.array(inlineNodeSchema).max(COMMENT_MAX_INLINE),
    }),
    z.object({
      type: z.literal('quote'),
      commentId: z.number().int().optional(),
      username: z.string().max(COMMENT_MAX_USERNAME).optional(),
      children: z.array(blockNodeSchema).max(COMMENT_MAX_BLOCKS),
    }),
    z.object({
      type: z.literal('image'),
      imageId: z.number().int(),
      alt: z.string().max(200).optional(),
    }),
  ]),
)

/** Deepest quote nesting and deepest inline (spoiler/link) nesting in a body. */
export const bodyDepth = (node: CommentNode): { quote: number; inline: number } => {
  let quote = 0
  let inline = 0
  const walk = (n: CommentNode, q: number, i: number): void => {
    if (n.type === 'quote') {
      q += 1
      if (q > quote) quote = q
    }
    if (n.type === 'spoiler' || n.type === 'link') {
      i += 1
      if (i > inline) inline = i
    }
    if ('children' in n) for (const c of n.children) walk(c, q, i)
  }
  walk(node, 0, 0)
  return { quote, inline }
}

/** The stored/submitted body shape. Route handlers parse untrusted input with this. */
export const commentBodySchema: z.ZodType<CommentBody> = z
  .object({
    type: z.literal('doc'),
    version: z.literal(1),
    children: z.array(blockNodeSchema).max(COMMENT_MAX_BLOCKS),
  })
  .superRefine((doc, ctx) => {
    const depth = bodyDepth(doc)
    if (depth.quote > COMMENT_MAX_QUOTE_DEPTH)
      ctx.addIssue({
        code: 'custom',
        message: messages.commentThread.quoteTooDeep,
        path: ['children'],
      })
    if (depth.inline > COMMENT_MAX_INLINE_DEPTH)
      ctx.addIssue({
        code: 'custom',
        message: messages.commentThread.formattingTooDeep,
        path: ['children'],
      })
  })

/** Structural validation of an untrusted body. Does not check length — see `plainText`. */
export const isCommentBody = (v: unknown): v is CommentBody =>
  commentBodySchema.safeParse(v).success

/** Build a body from plain text: paragraphs split on blank lines, line breaks kept. */
export const bodyFromText = (text: string): CommentBody => ({
  type: 'doc',
  version: 1,
  children: text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({
      type: 'paragraph' as const,
      children: p
        .split('\n')
        .flatMap((line, i): InlineNode[] =>
          i === 0
            ? [{ type: 'text', text: line }]
            : [{ type: 'hard_break' }, { type: 'text', text: line }],
        ),
    })),
})

/** Plain text of a body — used for length limits, link detection, dedupe and automod. */
export const plainText = (node: CommentNode): string => {
  switch (node.type) {
    case 'doc':
      return node.children.map(plainText).join('\n\n')
    case 'paragraph':
      return node.children.map(plainText).join('')
    case 'quote':
      return node.children.map(plainText).join('\n')
    case 'image':
      return node.alt ?? ''
    case 'text':
      return node.text
    case 'spoiler':
    case 'link':
      return node.children.map(plainText).join('')
    case 'mention':
      return `@${node.username}`
    case 'hard_break':
      return '\n'
  }
}

/** All link hrefs in a body (link nodes only — bare-domain text is detected separately). */
export const linkHrefs = (node: CommentNode): string[] => {
  const out: string[] = []
  const walk = (n: CommentNode): void => {
    if (n.type === 'link') out.push(n.href)
    if ('children' in n) for (const c of n.children) walk(c)
  }
  walk(node)
  return out
}

const linkLabelKey = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')

/**
 * Link nodes whose visible label is a different address than their `href` — "click here"
 * pointing at spam, or `palscans.org` pointing elsewhere. Staff may post such links;
 * everyone else's are rejected so a client cannot smuggle a destination past the reader.
 */
export const misleadingLinks = (node: CommentNode): LinkNode[] => {
  const out: LinkNode[] = []
  const walk = (n: CommentNode): void => {
    if (n.type === 'link') {
      const label = linkLabelKey(n.children.map(plainText).join(''))
      if (label && label !== linkLabelKey(n.href)) out.push(n)
    }
    if ('children' in n) for (const c of n.children) walk(c)
  }
  walk(node)
  return out
}

/** Mentioned usernames (deduplicated, original case). */
export const mentions = (node: CommentNode): string[] => {
  const out: string[] = []
  const seen = new Set<string>()
  const walk = (n: CommentNode): void => {
    if (n.type === 'mention' && !seen.has(n.username.toLowerCase())) {
      seen.add(n.username.toLowerCase())
      out.push(n.username)
    }
    if ('children' in n) for (const c of n.children) walk(c)
  }
  walk(node)
  return out
}

export const imageIds = (node: CommentNode): number[] => {
  const out: number[] = []
  const walk = (n: CommentNode): void => {
    if (n.type === 'image') out.push(n.imageId)
    if ('children' in n) for (const c of n.children) walk(c)
  }
  walk(node)
  return out
}

export const hasSpoiler = (node: CommentNode): boolean => {
  if (node.type === 'spoiler') return true
  if ('children' in node) return node.children.some(hasSpoiler)
  return false
}
