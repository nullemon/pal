import {
  chapters,
  comments,
  createDb,
  type Db,
  type DbHandle,
  entitlements,
  executeRows,
  runMigrations,
  series,
  userBlocks,
  users,
} from '@palscans/db'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { listComments, listReplies } from '../queries'
import type { CommentSort, CommentViewer } from '../types'

const now = new Date('2026-09-04T12:00:00Z')
const HOUR = 3_600_000
const ago = (hours: number) => new Date(now.getTime() - hours * HOUR)
const body = (text: string) => ({
  type: 'doc' as const,
  version: 1 as const,
  children: [{ type: 'paragraph', children: [{ type: 'text', text }] }],
})

let handle: DbHandle
let db: Db
/** Every comment in the fixture, by the name the assertions use for it. */
type Name =
  | 'pinned'
  | 'old10'
  | 'fresh3'
  | 'stub'
  | 'zeroPremium'
  | 'zeroPlain'
  | 'negative'
  | 'childless'
  | 'mine'
  | 'shadow'
  | 'byBlocked'
  | 'onChapter'
  | 'reply1'
  | 'reply2'
  | 'replyGone'
  | 'reply3'
const id = {} as Record<Name, number>
let seriesId = 0
let chapterId = 0
let authorId = 0
let premiumId = 0
let viewerId = 0
let blockedId = 0

const viewer = (over: Partial<CommentViewer> = {}): CommentViewer => ({
  id: viewerId,
  username: 'viewer',
  displayName: 'viewer',
  avatarUrl: null,
  role: 'user',
  isPremium: false,
  verified: true,
  canModerate: false,
  blockedIds: [blockedId],
  canUseCustomGifs: false,
  canSeeReactors: false,
  ...over,
})

/** `insert … returning id`, named so the assertions can talk about comments by name. */
const add = async (
  name: Name,
  row: Partial<typeof comments.$inferInsert> & { createdAt: Date },
): Promise<number> => {
  const [r] = await db
    .insert(comments)
    .values({
      userId: authorId,
      seriesId,
      body: body(name),
      ...row,
    } as typeof comments.$inferInsert)
    .returning({ id: comments.id })
  if (!r) throw new Error(`insert failed: ${name}`)
  id[name] = r.id
  return r.id
}

const idsOf = async (sort: CommentSort, v: CommentViewer | null = null) =>
  (
    await listComments(db, { target: { kind: 'series', id: seriesId }, sort, viewer: v })
  ).comments.map((c) => c.id)

beforeAll(async () => {
  handle = await createDb('pglite://memory')
  await runMigrations(handle)
  db = handle.db

  const inserted = await db
    .insert(users)
    .values([
      { email: 'author@listing.test', username: 'author' },
      { email: 'premium@listing.test', username: 'premium' },
      { email: 'viewer@listing.test', username: 'viewer' },
      { email: 'blocked@listing.test', username: 'blocked' },
    ])
    .returning({ id: users.id })
  const [a, p, v, b] = inserted
  if (!a || !p || !v || !b) throw new Error('users not inserted')
  authorId = a.id
  premiumId = p.id
  viewerId = v.id
  blockedId = b.id
  await db
    .insert(entitlements)
    .values({ userId: premiumId, feature: 'premium_content', source: 'subscription' })
  await db.insert(userBlocks).values({ blockerId: viewerId, blockedId })

  const [s] = await db
    .insert(series)
    .values({ slug: 'listing-test', title: 'Listing Test', type: 'manhwa', state: 'published' })
    .returning({ id: series.id })
  if (!s) throw new Error('series not inserted')
  seriesId = s.id
  const [c] = await db
    .insert(chapters)
    .values({ seriesId, number: 1, state: 'published' })
    .returning({ id: chapters.id })
  if (!c) throw new Error('chapter not inserted')
  chapterId = c.id

  // docs/14 §1 — "Best" is the decayed score (24h half-life), Premium first among equals,
  // then newest. Scores below are chosen so every rule is exercised:
  //   pinned                     → always first
  //   fresh:3 (3.00)  >  old:10 (2.50)  >  stub:1 (0.71)  > the score-0 rows > negative
  //   among the score-0 rows the Premium author sorts above the older non-Premium one
  await add('pinned', { createdAt: ago(200), score: 0, isPinned: true })
  await add('old10', { createdAt: ago(48), score: 10 })
  await add('fresh3', { createdAt: ago(0), score: 3 })
  await add('stub', { createdAt: ago(12), score: 1 }) // deleted below, keeps its reply
  await add('zeroPremium', { createdAt: ago(6), score: 0, userId: premiumId })
  await add('zeroPlain', { createdAt: ago(5), score: 0 })
  await add('negative', { createdAt: ago(1), score: -5 })
  await add('childless', { createdAt: ago(3), score: 2 }) // deleted below, no replies
  await add('mine', { createdAt: ago(4), score: 4, status: 'pending', userId: viewerId })
  await add('shadow', { createdAt: ago(4), score: 4, status: 'shadow', userId: viewerId })
  await add('byBlocked', { createdAt: ago(2), score: 7, userId: blockedId })
  await add('onChapter', { createdAt: ago(2), score: 1, seriesId: null, chapterId })

  // replies: the stub keeps one live reply (so it survives its own deletion), and one of its
  // replies is deleted itself (so it must not render).
  await add('reply1', { createdAt: ago(11), parentId: id.stub })
  await add('reply2', { createdAt: ago(10), parentId: id.stub })
  await add('replyGone', { createdAt: ago(9), parentId: id.stub })
  await add('reply3', { createdAt: ago(8), parentId: id.stub })

  const del = (commentId: number) =>
    db.update(comments).set({ deletedAt: now }).where(sql`${comments.id} = ${commentId}`)
  await del(id.replyGone)
  await del(id.stub)
  await del(id.childless)
}, 120_000)

afterAll(async () => {
  await handle?.close()
})

describe('comment visibility (docs/14 §1)', () => {
  it('keeps a deleted comment that still has replies, as an empty stub', async () => {
    const page = await listComments(db, {
      target: { kind: 'series', id: seriesId },
      sort: 'best',
      viewer: null,
    })
    const stub = page.comments.find((c) => c.id === id.stub)
    expect(stub).toBeDefined()
    expect(stub?.deleted).toBe(true)
    expect(stub?.body.children).toEqual([])
    expect(stub?.replyCount).toBe(3)
    // its own deleted reply is gone; the live ones still preview, oldest first
    expect(stub?.replies.map((r) => r.id)).toEqual([id.reply1, id.reply2])
    const replies = await listReplies(db, id.stub, null)
    expect(replies.map((r) => r.id)).toEqual([id.reply1, id.reply2, id.reply3])
  })

  it('drops a deleted comment that has no replies', async () => {
    expect(await idsOf('best')).not.toContain(id.childless)
    expect(await idsOf('newest')).not.toContain(id.childless)
  })

  it('shows pending and shadowed comments to their author only', async () => {
    const anon = await idsOf('best')
    expect(anon).not.toContain(id.mine)
    expect(anon).not.toContain(id.shadow)
    const mine = await idsOf('best', viewer())
    expect(mine).toContain(id.mine)
    expect(mine).toContain(id.shadow)
  })

  it('hides a blocked author from the blocker only', async () => {
    expect(await idsOf('best')).toContain(id.byBlocked)
    expect(await idsOf('best', viewer())).not.toContain(id.byBlocked)
  })

  it('counts only what the viewer can see, and keeps targets apart', async () => {
    const page = await listComments(db, {
      target: { kind: 'series', id: seriesId },
      sort: 'best',
      viewer: null,
    })
    expect(page.total).toBe(page.comments.length)
    expect(page.comments.map((c) => c.id)).not.toContain(id.onChapter)
    const chapter = await listComments(db, {
      target: { kind: 'chapter', id: chapterId },
      sort: 'best',
      viewer: null,
    })
    expect(chapter.comments.map((c) => c.id)).toEqual([id.onChapter])
  })
})

describe('comment sort order (docs/14 §1)', () => {
  it('best: pinned, then decayed score, Premium first among equals, then newest', async () => {
    expect(await idsOf('best')).toEqual([
      id.pinned,
      id.byBlocked,
      id.fresh3,
      id.old10,
      id.stub,
      id.zeroPremium,
      id.zeroPlain,
      id.negative,
    ])
  })

  it('newest and oldest keep the pin on top and mirror each other', async () => {
    expect(await idsOf('newest')).toEqual([
      id.pinned,
      id.fresh3,
      id.negative,
      id.byBlocked,
      id.zeroPlain,
      id.zeroPremium,
      id.stub,
      id.old10,
    ])
    expect(await idsOf('oldest')).toEqual([
      id.pinned,
      id.old10,
      id.stub,
      id.zeroPremium,
      id.zeroPlain,
      id.byBlocked,
      id.negative,
      id.fresh3,
    ])
  })

  it('paginates without dropping or repeating a row', async () => {
    const all = await idsOf('best')
    const first = await listComments(db, {
      target: { kind: 'series', id: seriesId },
      sort: 'best',
      limit: 3,
      viewer: null,
    })
    expect(first.comments.map((c) => c.id)).toEqual(all.slice(0, 3))
    expect(first.nextCursor).toBe('3')
    const second = await listComments(db, {
      target: { kind: 'series', id: seriesId },
      sort: 'best',
      limit: 3,
      cursor: first.nextCursor ?? undefined,
      viewer: null,
    })
    expect(second.comments.map((c) => c.id)).toEqual(all.slice(3, 6))
  })
})

describe('comments.hot (the stored form of the decayed score)', () => {
  it('is stored beside `visible`, with the partial indexes that serve a page', async () => {
    const cols = await executeRows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns
          where table_name = 'comments' and is_generated = 'ALWAYS' order by column_name`,
    )
    expect(cols.map((c) => c.column_name)).toEqual(['hot', 'visible'])
    const idx = await executeRows<{ indexname: string }>(
      db,
      sql`select indexname from pg_indexes
          where tablename = 'comments' and indexdef like '%visible%' order by indexname`,
    )
    expect(idx.map((i) => i.indexname)).toEqual([
      'comments_chapter_recent_idx',
      'comments_chapter_thread_idx',
      'comments_parent_visible_idx',
      'comments_series_recent_idx',
      'comments_series_thread_idx',
    ])
  })

  it('orders exactly like `score * 0.5 ^ (age / 24h)` did', async () => {
    // A spread wider than the fixture: every score sign, ages from minutes to a year, and
    // pairs that tie (score 2 a day older than score 1 is the same decayed score).
    await executeRows(
      db,
      sql`insert into comments (user_id, series_id, body, score, created_at)
          select ${authorId}, ${seriesId}, '{"type":"doc","version":1,"children":[]}'::jsonb,
                 s, now() - (h || ' hours')::interval
          from generate_series(-8, 60) s, generate_series(0, 8760, 137) h`,
    )
    const [row] = await executeRows<{ compared: number; mismatches: number }>(
      db,
      sql`with r as (
            select row_number() over (order by
                     (score * power(0.5, extract(epoch from (now() - created_at)) / 86400.0)) desc,
                     created_at desc, id desc) as old_rn,
                   row_number() over (order by hot desc, created_at desc, id desc) as new_rn
            from comments)
          select count(*)::int as compared,
                 count(*) filter (where old_rn <> new_rn)::int as mismatches
          from r`,
    )
    expect(Number(row?.compared)).toBeGreaterThan(4000)
    expect(Number(row?.mismatches)).toBe(0)
  }, 60_000)
})
