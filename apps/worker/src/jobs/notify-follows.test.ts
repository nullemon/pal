import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  bookmarks,
  chapters,
  comments,
  createDb,
  type Db,
  type DbHandle,
  notificationPrefs,
  notifications,
  runMigrations,
  series,
  seriesFollows,
  users,
} from '@palscans/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defaultNotificationSettings } from '../../../web/lib/notifications/index.js'
import { sweepCommentNotices } from './notify-comment.js'
import { publishDue } from './publish.js'

/**
 * The in-app half of the new-chapter fan-out, and the comment sweep — the two things the
 * worker owns that had to learn about follows.
 *
 * `publishDue` writes the in-app row inside the publish transaction, so this is the test
 * that a muted series is muted *everywhere*, not only on the channels the later push sweep
 * handles.
 */
let dir: string
let handle: DbHandle
let db: Db
let seriesId = 0

const reader = { bookmarkOnly: 0, followPush: 0, digestOnly: 0, muted: 0, inAppOff: 0 }

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-follows-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  await runMigrations(handle)
  db = handle.db

  const inserted = await db
    .insert(users)
    .values(
      (Object.keys(reader) as Array<keyof typeof reader>).map((name) => ({
        email: `${name}@followpublish.test`,
        username: name.toLowerCase(),
      })),
    )
    .returning({ id: users.id })
  ;(Object.keys(reader) as Array<keyof typeof reader>).forEach((name, i) => {
    const row = inserted[i]
    if (!row) throw new Error('user not inserted')
    reader[name] = row.id
  })

  const [s] = await db
    .insert(series)
    .values({
      slug: 'publish-follows',
      title: 'Publish Follows',
      type: 'manga',
      state: 'published',
    })
    .returning({ id: series.id })
  if (!s) throw new Error('series not inserted')
  seriesId = s.id

  await db.insert(bookmarks).values([
    { userId: reader.bookmarkOnly, seriesId },
    { userId: reader.muted, seriesId, status: 'completed' },
    { userId: reader.inAppOff, seriesId },
  ])
  await db.insert(seriesFollows).values([
    { userId: reader.followPush, seriesId, mode: 'push' },
    { userId: reader.digestOnly, seriesId, mode: 'digest' },
    { userId: reader.muted, seriesId, mode: 'off' },
  ])
  await db
    .insert(notificationPrefs)
    .values({ userId: reader.inAppOff, kind: 'new_chapter', channel: 'in_app', enabled: false })
}, 180_000)

afterAll(async () => {
  await handle.close()
  await rm(dir, { recursive: true, force: true })
})

describe('publishing a chapter', () => {
  it('writes an in-app row for followers only', async () => {
    const now = new Date('2026-09-05T12:00:00Z')
    const [c] = await db
      .insert(chapters)
      .values({
        seriesId,
        number: 1,
        state: 'scheduled',
        pageCount: 1,
        publishedAt: new Date(now.getTime() - 60_000),
      })
      .returning({ id: chapters.id })
    if (!c) throw new Error('chapter not inserted')
    expect((await publishDue(db, now)).map((r) => r.id)).toContain(c.id)

    const rows = await db
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(eq(notifications.kind, 'new_chapter'))
    const told = rows.map((r) => r.userId).sort((a, b) => a - b)
    // A bookmark with no follow row is still an implicit follow, `push` includes the bell,
    // and the other three each said no in a different way.
    expect(told).toEqual([reader.bookmarkOnly, reader.followPush].sort((a, b) => a - b))
  })
})

describe('the comment sweep', () => {
  it('picks up a reply the submit path never got to notify about', async () => {
    const body = {
      type: 'doc' as const,
      version: 1 as const,
      children: [{ type: 'paragraph', children: [{ type: 'text', text: 'hello' }] }],
    }
    const [parent] = await db
      .insert(comments)
      .values({ userId: reader.bookmarkOnly, seriesId, body, status: 'published' })
      .returning({ id: comments.id })
    if (!parent) throw new Error('parent not inserted')
    const [reply] = await db
      .insert(comments)
      .values({
        userId: reader.followPush,
        seriesId,
        parentId: parent.id,
        body,
        status: 'published',
      })
      .returning({ id: comments.id })
    if (!reply) throw new Error('reply not inserted')

    const settings = { ...defaultNotificationSettings, push: { enabled: false, ttlSeconds: 60 } }
    const first = await sweepCommentNotices(db, { settings, after: 0 })
    expect(first.considered).toBe(1)
    expect(first.after).toBe(reply.id)
    const rows = await db
      .select({ userId: notifications.userId, kind: notifications.kind })
      .from(notifications)
      .where(eq(notifications.kind, 'reply'))
    expect(rows).toEqual([{ userId: reader.bookmarkOnly, kind: 'reply' }])

    // The watermark means a second pass looks at nothing at all.
    const second = await sweepCommentNotices(db, { settings, after: first.after })
    expect(second.considered).toBe(0)
  })
})
