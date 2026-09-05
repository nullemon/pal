import {
  bookmarks,
  chapters,
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
import { afterAll, beforeAll, expect, it } from 'vitest'
import { notifyFollowers } from '@/components/admin/server/chapters'

/**
 * `Admin → Publish now` used to insert one `new_chapter` row per **bookmark**, consulting
 * neither `series_follows` nor `notification_prefs` — so a reader who muted a series still
 * heard from it whenever a moderator pressed the button, while the scheduled path (through
 * `apps/worker/src/jobs/publish.ts`) stayed quiet. Both gates apply here too now, and with
 * them the implicit-follow rule: a bookmark with no follow row still means `all`, which is
 * what every bookmarker had before follows existed.
 */
let handle: DbHandle
let db: Db
const reader = { bookmarkOnly: 0, mutedButShelved: 0, digestOnly: 0, inAppOff: 0, stranger: 0 }
let seriesId = 0
let chapterId = 0

beforeAll(async () => {
  handle = await createDb('pglite://memory')
  await runMigrations(handle)
  db = handle.db

  const names = Object.keys(reader) as Array<keyof typeof reader>
  const rows = await db
    .insert(users)
    .values(names.map((n) => ({ email: `${n}@publish.test`, username: n.toLowerCase() })))
    .returning({ id: users.id })
  names.forEach((n, i) => {
    const row = rows[i]
    if (!row) throw new Error('user not inserted')
    reader[n] = row.id
  })

  const [s] = await db
    .insert(series)
    .values({
      slug: 'publish-now-probe',
      title: 'Publish Now Probe',
      type: 'manga',
      state: 'published',
    })
    .returning({ id: series.id })
  if (!s) throw new Error('series not inserted')
  seriesId = s.id

  const [c] = await db
    .insert(chapters)
    .values({ seriesId, number: 1, state: 'published', pageCount: 1, publishedAt: new Date() })
    .returning({ id: chapters.id })
  if (!c) throw new Error('chapter not inserted')
  chapterId = c.id

  // A shelf and nothing else — what every existing bookmarker is.
  await db.insert(bookmarks).values({ userId: reader.bookmarkOnly, seriesId, status: 'reading' })
  // Finished it, left it on a shelf, muted it: the case that motivated follows at all.
  await db
    .insert(bookmarks)
    .values({ userId: reader.mutedButShelved, seriesId, status: 'completed' })
  await db.insert(seriesFollows).values({ userId: reader.mutedButShelved, seriesId, mode: 'off' })
  // Wants it in the weekly email, not on the bell.
  await db.insert(seriesFollows).values({ userId: reader.digestOnly, seriesId, mode: 'digest' })
  // Follows it, but switched in-app notices off globally.
  await db.insert(bookmarks).values({ userId: reader.inAppOff, seriesId, status: 'reading' })
  await db
    .insert(notificationPrefs)
    .values({ userId: reader.inAppOff, kind: 'new_chapter', channel: 'in_app', enabled: false })
})

afterAll(async () => {
  await handle.close()
})

it('publish now notifies followers, not bookmarkers', async () => {
  await notifyFollowers(db as never, chapterId, seriesId, 1)
  const got = new Set(
    (await db.select({ userId: notifications.userId }).from(notifications)).map((r) => r.userId),
  )
  expect(got.has(reader.bookmarkOnly)).toBe(true)
  expect(got.has(reader.mutedButShelved)).toBe(false)
  expect(got.has(reader.digestOnly)).toBe(false)
  expect(got.has(reader.inAppOff)).toBe(false)
  expect(got.has(reader.stranger)).toBe(false)
})
