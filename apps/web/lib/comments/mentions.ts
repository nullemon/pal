import type { BlockNode, CommentBody, InlineNode } from '@palscans/core/comments'
import { mentions as mentionsOf } from '@palscans/core/comments'
import { type Db, users } from '@palscans/db'
import { and, inArray, isNull } from 'drizzle-orm'

/**
 * `@username` — resolved, linked and bounded (docs/14 §1, "Notifications").
 *
 * The composer turns `@name` into a `{type:'mention'}` node on the client, but the client is
 * not evidence: until now nothing checked that the name belonged to anybody, so a comment
 * could ship a highlighted link to `/u/does-not-exist`, and the casing was whatever the
 * author typed. This module is the server's answer — it runs inside the submit pipeline,
 * before the row is written:
 *
 *  - a mention of a live account keeps its node, with the account's **canonical** username
 *    and its `userId` stamped on it, so the rendered link is guaranteed to resolve;
 *  - a mention of nobody degrades to plain text, because a link that 404s is worse than the
 *    literal characters the author typed;
 *  - the whole thing is capped, so a body cannot become a fan-out.
 *
 * Who then gets *notified* is a further, smaller question — see `notify.ts`, which applies
 * the block list and the rate limits on top of what is resolved here.
 */

/**
 * The most mentions one comment may *resolve*, whatever the operator's `max_mentions` says.
 * `max_mentions` is a moderation setting an operator can raise; this is the structural
 * ceiling that keeps one insert from turning into an unbounded `IN (…)` and an unbounded
 * fan-out. `COMMENT_MAX_MENTIONS` in @palscans/core is the same number for the composer.
 */
export const MAX_RESOLVED_MENTIONS = 5

export interface ResolvedMention {
  userId: number
  username: string
}

export interface MentionResolution {
  /** The body to store: real mentions linked, unknown ones flattened to text. */
  body: CommentBody
  /** Live accounts named in the body, deduplicated, in the order they appear, capped. */
  mentioned: ResolvedMention[]
  /** Names that matched nobody — kept only so callers can report or count them. */
  unknown: string[]
}

const mapInline = (
  nodes: readonly InlineNode[],
  fn: (n: InlineNode) => InlineNode[],
): InlineNode[] =>
  nodes.flatMap((n) => {
    if (n.type === 'spoiler' || n.type === 'link')
      return [{ ...n, children: mapInline(n.children, fn) } as InlineNode]
    return fn(n)
  })

const mapBlock = (node: BlockNode, fn: (n: InlineNode) => InlineNode[]): BlockNode => {
  switch (node.type) {
    case 'paragraph':
      return { ...node, children: mapInline(node.children, fn) }
    case 'quote':
      return { ...node, children: node.children.map((c) => mapBlock(c, fn)) }
    default:
      return node
  }
}

/**
 * Look the names up and rewrite the body. One query, `citext` usernames so the match is
 * case-insensitive; deleted accounts are not accounts.
 */
export const resolveMentions = async (
  db: Db,
  body: CommentBody,
  opts: { max?: number } = {},
): Promise<MentionResolution> => {
  const max = Math.max(0, Math.min(opts.max ?? MAX_RESOLVED_MENTIONS, MAX_RESOLVED_MENTIONS))
  const named = mentionsOf(body).slice(0, max)
  if (named.length === 0) return { body, mentioned: [], unknown: [] }
  // `users.username` is `citext`, so this equality is case-insensitive *and* index-backed —
  // no `lower()` wrapper, which would have cost a sequential scan on every comment posted.
  const rows = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(and(inArray(users.username, named), isNull(users.deletedAt)))
  const byLower = new Map<string, ResolvedMention>()
  for (const r of rows)
    if (r.username) byLower.set(r.username.toLowerCase(), { userId: r.id, username: r.username })

  const mentioned: ResolvedMention[] = []
  const unknown: string[] = []
  const seen = new Set<string>()
  for (const name of named) {
    const hit = byLower.get(name.toLowerCase())
    if (!hit) {
      unknown.push(name)
      continue
    }
    if (seen.has(hit.username.toLowerCase())) continue
    seen.add(hit.username.toLowerCase())
    mentioned.push(hit)
  }

  /** Beyond the cap a mention is left as text: it is not linked and it notifies nobody. */
  const linkable = new Map(mentioned.map((m) => [m.username.toLowerCase(), m]))
  const rewrite = (n: InlineNode): InlineNode[] => {
    if (n.type !== 'mention') return [n]
    const hit = linkable.get(n.username.toLowerCase())
    if (!hit) return [{ type: 'text', text: `@${n.username}` }]
    return [{ type: 'mention', username: hit.username, userId: hit.userId }]
  }
  return {
    body: { ...body, children: body.children.map((b) => mapBlock(b, rewrite)) },
    mentioned,
    unknown,
  }
}
