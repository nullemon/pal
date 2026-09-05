import type { CommentBody } from '@palscans/core/comments'
import {
  chapters,
  commentMentions,
  comments,
  createDb,
  type Db,
  type DbHandle,
  notificationDeliveries,
  notificationPrefs,
  notifications,
  runMigrations,
  series,
  userBlocks,
  users,
} from '@palscans/db'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_RESOLVED_MENTIONS, resolveMentions } from '../mentions'
import {
  blockPairKey,
  commentNoticeTargets,
  fanoutCommentNotice,
  MAX_MENTION_NOTIFICATIONS,
  MENTION_NOTIFY_PER_PAIR_PER_HOUR,
} from '../notify'
import { MemoryRateLimiter } from '../rate-limit'

/**
 * `@mentions` and reply notifications (docs/14 "Notifications").
 *
 * Three things are worth a test and all three are here: what a mention *becomes* when the
 * server has looked at it, who is told about a comment, and — the part that matters most —
 * who is deliberately not told: yourself, someone who blocked you, someone who switched the
 * kind off, and someone you have already pinged three times this hour.
 */

let handle: DbHandle
let db: Db
let seriesId = 0
let chapterId = 0

const user = { author: 0, target: 0, blocker: 0, blocked: 0, quiet: 0 }

const body = (children: CommentBody['children']): CommentBody => ({
  type: 'doc',
  version: 1,
  children,
})

const mention = (username: string) => ({ type: 'mention' as const, username })
const text = (t: string) => ({ type: 'text' as const, text: t })

const addComment = async (over: Partial<typeof comments.$inferInsert> = {}) => {
  const [row] = await db
    .insert(comments)
    .values({
      userId: user.author,
      seriesId,
      chapterId,
      body: body([{ type: 'paragraph', children: [text('hi')] }]),
      status: 'published',
      ...over,
    } as typeof comments.$inferInsert)
    .returning({ id: comments.id })
  if (!row) throw new Error('comment insert failed')
  return row.id
}

const fanout = (commentId: number, limiter = new MemoryRateLimiter()) =>
  fanoutCommentNotice(db, commentId, { limiter, push: false })

const noticesFor = async (userId: number) =>
  db
    .select({ kind: notifications.kind, payload: notifications.payload })
    .from(notifications)
    .where(eq(notifications.userId, userId))

beforeAll(async () => {
  handle = await createDb('pglite://memory')
  await runMigrations(handle)
  db = handle.db

  const inserted = await db
    .insert(users)
    .values([
      { email: 'author@mentions.test', username: 'Author' },
      { email: 'target@mentions.test', username: 'Target' },
      { email: 'blocker@mentions.test', username: 'Blocker' },
      { email: 'blocked@mentions.test', username: 'Blocked' },
      { email: 'quiet@mentions.test', username: 'Quiet' },
    ])
    .returning({ id: users.id })
  const [a, t, br, bd, q] = inserted
  if (!a || !t || !br || !bd || !q) throw new Error('users not inserted')
  user.author = a.id
  user.target = t.id
  user.blocker = br.id
  user.blocked = bd.id
  user.quiet = q.id

  // The blocker does not want to hear from the author; `Blocked` is blocked *by* the author.
  await db.insert(userBlocks).values([
    { blockerId: user.blocker, blockedId: user.author },
    { blockerId: user.author, blockedId: user.blocked },
  ])
  // `Quiet` switched replies and mentions off in the preference matrix.
  await db
    .insert(notificationPrefs)
    .values({ userId: user.quiet, kind: 'reply', channel: 'in_app', enabled: false })

  const [s] = await db
    .insert(series)
    .values({ slug: 'mention-probe', title: 'Mention Probe', type: 'manga', state: 'published' })
    .returning({ id: series.id })
  if (!s) throw new Error('series not inserted')
  seriesId = s.id
  const [c] = await db
    .insert(chapters)
    .values({
      seriesId,
      number: 1,
      state: 'published',
      pageCount: 1,
      publishedAt: new Date('2026-09-01T00:00:00Z'),
    })
    .returning({ id: chapters.id })
  if (!c) throw new Error('chapter not inserted')
  chapterId = c.id
}, 120_000)

afterAll(async () => {
  await handle.close()
})

describe('resolveMentions', () => {
  it('links a real account, with the canonical username and its id', async () => {
    const out = await resolveMentions(
      db,
      body([{ type: 'paragraph', children: [mention('target'), text(' hello')] }]),
    )
    expect(out.mentioned).toEqual([{ userId: user.target, username: 'Target' }])
    expect(out.body.children[0]).toEqual({
      type: 'paragraph',
      children: [{ type: 'mention', username: 'Target', userId: user.target }, text(' hello')],
    })
  })

  it('flattens a mention of nobody to plain text rather than linking a 404', async () => {
    const out = await resolveMentions(
      db,
      body([{ type: 'paragraph', children: [mention('ghost')] }]),
    )
    expect(out.mentioned).toEqual([])
    expect(out.unknown).toEqual(['ghost'])
    expect(out.body.children[0]).toEqual({
      type: 'paragraph',
      children: [text('@ghost')],
    })
  })

  it('reaches mentions nested inside a spoiler', async () => {
    const out = await resolveMentions(
      db,
      body([
        {
          type: 'paragraph',
          children: [{ type: 'spoiler', children: [mention('target')] }],
        },
      ]),
    )
    expect(out.mentioned).toEqual([{ userId: user.target, username: 'Target' }])
  })

  it('caps how many mentions one comment can resolve, and de-links the overflow', async () => {
    const names = ['author', 'target', 'blocker', 'blocked', 'quiet', 'target']
    const out = await resolveMentions(
      db,
      body([{ type: 'paragraph', children: names.map(mention) }]),
      { max: 2 },
    )
    expect(out.mentioned).toHaveLength(2)
    const rendered = (
      out.body.children[0] as unknown as {
        children: Array<{ type: string; text?: string }>
      }
    ).children
    expect(rendered.filter((n) => n.type === 'mention')).toHaveLength(3) // two names, one repeated
    expect(rendered.filter((n) => n.type === 'text').map((n) => n.text)).toEqual([
      '@blocker',
      '@blocked',
      '@quiet',
    ])
  })

  it('never resolves more than the structural ceiling, whatever the caller asks for', async () => {
    const out = await resolveMentions(
      db,
      body([
        {
          type: 'paragraph',
          children: ['author', 'target', 'blocker', 'blocked', 'quiet'].map(mention),
        },
      ]),
      { max: 99 },
    )
    expect(out.mentioned.length).toBeLessThanOrEqual(MAX_RESOLVED_MENTIONS)
  })
})

describe('commentNoticeTargets', () => {
  const none = new Set<string>()

  it('never notifies the author, of their own reply or their own name', () => {
    expect(
      commentNoticeTargets({
        authorId: 1,
        parentAuthorId: 1,
        mentionedIds: [1],
        blockedPairs: none,
      }),
    ).toEqual([])
  })

  it('sends one notice, not two, when a reply also names the person', () => {
    expect(
      commentNoticeTargets({
        authorId: 1,
        parentAuthorId: 2,
        mentionedIds: [2, 3],
        blockedPairs: none,
      }),
    ).toEqual([
      { userId: 2, kind: 'reply' },
      { userId: 3, kind: 'mention' },
    ])
  })

  it('caps the mentions one comment may notify', () => {
    const many = Array.from({ length: 20 }, (_, i) => i + 2)
    expect(
      commentNoticeTargets({
        authorId: 1,
        parentAuthorId: null,
        mentionedIds: many,
        blockedPairs: none,
      }),
    ).toHaveLength(MAX_MENTION_NOTIFICATIONS)
  })

  it('drops anyone on either side of a block', () => {
    const blocked = new Set([blockPairKey(2, 1), blockPairKey(1, 3)])
    expect(
      commentNoticeTargets({
        authorId: 1,
        parentAuthorId: 2,
        mentionedIds: [3, 4],
        blockedPairs: blocked,
      }),
    ).toEqual([{ userId: 4, kind: 'mention' }])
  })
})

describe('fanoutCommentNotice', () => {
  it('tells the parent comment author they were replied to', async () => {
    const parent = await addComment({ userId: user.target })
    const reply = await addComment({ parentId: parent })
    const summary = await fanout(reply)
    expect(summary.inApp).toBe(1)
    const rows = await noticesFor(user.target)
    expect(rows.map((r) => r.kind)).toContain('reply')
    const payload = rows[0]?.payload as { href?: string } | undefined
    expect(payload?.href).toBe(`/series/mention-probe/chapter-1#comment-${reply}`)
  })

  it('tells a mentioned reader, and records the send in the ledger', async () => {
    const c = await addComment()
    await db.insert(commentMentions).values({ commentId: c, userId: user.quiet })
    await db.insert(commentMentions).values({ commentId: c, userId: user.target })
    const summary = await fanout(c)
    expect(summary.inApp).toBe(1) // `quiet` turned the kind off
    const sent = await db
      .select({ status: notificationDeliveries.status, detail: notificationDeliveries.detail })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.dedupeKey, `comment:${c}:mention`),
          eq(notificationDeliveries.userId, user.quiet),
        ),
      )
    expect(sent).toEqual([{ status: 'skipped', detail: 'preference off' }])
  })

  it('does not let a blocked account reach the reader who blocked them', async () => {
    const before = (await noticesFor(user.blocker)).length
    const c = await addComment()
    await db.insert(commentMentions).values({ commentId: c, userId: user.blocker })
    const summary = await fanout(c)
    expect(summary.inApp).toBe(0)
    expect(await noticesFor(user.blocker)).toHaveLength(before)
  })

  it('suppresses a mention in the other direction too — the author blocked them', async () => {
    const before = (await noticesFor(user.blocked)).length
    const c = await addComment()
    await db.insert(commentMentions).values({ commentId: c, userId: user.blocked })
    expect((await fanout(c)).inApp).toBe(0)
    expect(await noticesFor(user.blocked)).toHaveLength(before)
  })

  it('says nothing about a comment that is held for review', async () => {
    const c = await addComment({ status: 'pending' })
    await db.insert(commentMentions).values({ commentId: c, userId: user.target })
    expect((await fanout(c)).inApp).toBe(0)
  })

  it('is idempotent — a re-run of the same comment notifies nobody twice', async () => {
    const c = await addComment()
    await db.insert(commentMentions).values({ commentId: c, userId: user.target })
    expect((await fanout(c)).inApp).toBe(1)
    const after = (await noticesFor(user.target)).length
    expect((await fanout(c)).inApp).toBe(0)
    expect(await noticesFor(user.target)).toHaveLength(after)
  })

  it('stops one account from pinging the same reader over and over', async () => {
    // One limiter across the run, so the per-pair hourly bucket is shared, as in production.
    const limiter = new MemoryRateLimiter()
    const outcomes: number[] = []
    for (let i = 0; i < MENTION_NOTIFY_PER_PAIR_PER_HOUR + 2; i++) {
      const c = await addComment()
      await db.insert(commentMentions).values({ commentId: c, userId: user.target })
      outcomes.push((await fanout(c, limiter)).inApp)
    }
    expect(outcomes.filter((n) => n === 1)).toHaveLength(MENTION_NOTIFY_PER_PAIR_PER_HOUR)
    expect(outcomes.slice(MENTION_NOTIFY_PER_PAIR_PER_HOUR)).toEqual([0, 0])
    const limited = await db
      .select({ detail: notificationDeliveries.detail })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.detail, 'mention pair rate limit'))
    expect(limited.length).toBeGreaterThanOrEqual(2)
  })
})
