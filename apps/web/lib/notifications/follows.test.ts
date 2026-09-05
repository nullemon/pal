import {
  bookmarks,
  chapters,
  createDb,
  type Db,
  type DbHandle,
  notificationDeliveries,
  notificationPrefs,
  pushSubscriptions,
  readingProgress,
  runMigrations,
  series,
  seriesFollows,
  users,
} from '@palscans/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { collectDigestRows } from './digest'
import { mergeFollowers, splitRecipients } from './follows'
import type { PrefRow } from './prefs'
import type { PushSender, StoredSubscription } from './push'
import { defaultNotificationSettings, followAllows } from './schema'
import { fanoutNewChapter } from './senders'

/**
 * Following a series, and the per-series notification settings (docs/17 §D).
 *
 * The point of these tests is the *combination*: a follow mode narrows what one series may
 * do, the global preference matrix narrows what a channel may do at all, and a bookmark with
 * no follow row still means "everything" — which is the promise that shipping follows
 * unsubscribed nobody. Each of the four is asserted separately below, and then together
 * against a real fan-out.
 */

let handle: DbHandle
let db: Db
let seriesId = 0
let chapterId = 0
let otherSeriesId = 0

const reader = {
  bookmarkOnly: 0,
  followAll: 0,
  digestOnly: 0,
  mutedButShelved: 0,
  inAppOnly: 0,
  pushOffGlobally: 0,
  progressOnly: 0,
}

/** Records what it was asked to send instead of reaching a push service. */
const capturingSender = () => {
  const sent: StoredSubscription[] = []
  const sender: PushSender = {
    async send(sub) {
      sent.push(sub)
      return { ok: true, statusCode: 201 }
    },
  }
  return { sender, sent }
}

const settings = () => ({
  ...defaultNotificationSettings,
  discord: { ...defaultNotificationSettings.discord, enabled: false },
})

beforeAll(async () => {
  handle = await createDb('pglite://memory')
  await runMigrations(handle)
  db = handle.db

  const inserted = await db
    .insert(users)
    .values(
      (Object.keys(reader) as Array<keyof typeof reader>).map((name) => ({
        email: `${name}@follows.test`,
        username: name.toLowerCase(),
      })),
    )
    .returning({ id: users.id })
  ;(Object.keys(reader) as Array<keyof typeof reader>).forEach((name, i) => {
    const row = inserted[i]
    if (!row) throw new Error('user not inserted')
    reader[name] = row.id
  })

  const [s, other] = await db
    .insert(series)
    .values([
      { slug: 'follow-probe', title: 'Follow Probe', type: 'manga', state: 'published' },
      { slug: 'follow-other', title: 'Follow Other', type: 'manga', state: 'published' },
    ])
    .returning({ id: series.id })
  if (!s || !other) throw new Error('series not inserted')
  seriesId = s.id
  otherSeriesId = other.id

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

  // Every reader has a device, so "did not get a push" can only be the settings.
  await db.insert(pushSubscriptions).values(
    Object.values(reader).map((id) => ({
      userId: id,
      endpoint: `https://fcm.googleapis.com/e/${id}`,
      p256dh: 'k',
      auth: 'a',
    })),
  )

  await db.insert(bookmarks).values([
    { userId: reader.bookmarkOnly, seriesId },
    { userId: reader.mutedButShelved, seriesId, status: 'completed' },
    { userId: reader.pushOffGlobally, seriesId },
    { userId: reader.digestOnly, seriesId },
  ])
  await db.insert(seriesFollows).values([
    { userId: reader.followAll, seriesId, mode: 'all' },
    { userId: reader.digestOnly, seriesId, mode: 'digest' },
    { userId: reader.mutedButShelved, seriesId, mode: 'off' },
    { userId: reader.inAppOnly, seriesId, mode: 'in_app' },
  ])
  // Global matrix: this reader wants nothing pushed, however loud a series is set.
  await db.insert(notificationPrefs).values({
    userId: reader.pushOffGlobally,
    kind: 'new_chapter',
    channel: 'push',
    enabled: false,
  })
  // Reading progress alone also feeds the digest (unchanged behaviour).
  await db
    .insert(readingProgress)
    .values({ userId: reader.progressOnly, seriesId, chapterId, pageIdx: 0 })
}, 120_000)

afterAll(async () => {
  await handle.close()
})

describe('followAllows', () => {
  it('lets everything through on the default mode', () => {
    for (const channel of ['in_app', 'push', 'email', 'discord'])
      expect(followAllows('all', channel)).toBe(true)
  })

  it('keeps `push` off email and Discord, and `digest` off everything instant', () => {
    expect(followAllows('push', 'push')).toBe(true)
    expect(followAllows('push', 'in_app')).toBe(true)
    expect(followAllows('push', 'email')).toBe(false)
    expect(followAllows('push', 'discord')).toBe(false)
    expect(followAllows('digest', 'email')).toBe(true)
    expect(followAllows('digest', 'push')).toBe(false)
    expect(followAllows('digest', 'in_app')).toBe(false)
  })

  it('sends nothing at all on `off`', () => {
    for (const channel of ['in_app', 'push', 'email', 'discord'])
      expect(followAllows('off', channel)).toBe(false)
  })
})

describe('mergeFollowers', () => {
  it('reads a bookmark with no follow row as a follow on `all`', () => {
    expect(mergeFollowers([], [7])).toEqual([{ userId: 7, mode: 'all', source: 'bookmark' }])
  })

  it('lets an explicit row win over the bookmark behind it — including `off`', () => {
    expect(mergeFollowers([{ userId: 7, mode: 'off' }], [7])).toEqual([
      { userId: 7, mode: 'off', source: 'follow' },
    ])
  })

  it('keeps a follow with no bookmark, and falls back to `all` on a junk mode', () => {
    expect(mergeFollowers([{ userId: 9, mode: 'nonsense' }], [])).toEqual([
      { userId: 9, mode: 'all', source: 'follow' },
    ])
  })
})

describe('splitRecipients', () => {
  const prefs: PrefRow[] = [{ userId: 3, kind: 'new_chapter', channel: 'push', enabled: false }]

  it('separates a muted series from a switched-off channel', () => {
    const out = splitRecipients(
      [
        { userId: 1, mode: 'all', source: 'follow' },
        { userId: 2, mode: 'digest', source: 'follow' },
        { userId: 3, mode: 'all', source: 'bookmark' },
      ],
      prefs,
      'new_chapter',
      'push',
    )
    expect(out.allowed).toEqual([1])
    expect(out.skipped).toEqual([
      { userId: 2, reason: 'series muted' },
      { userId: 3, reason: 'preference off' },
    ])
  })
})

describe('the new-chapter fan-out', () => {
  it('pushes to followers only, and records why everyone else was skipped', async () => {
    const { sender, sent } = capturingSender()
    const summary = await fanoutNewChapter(db, chapterId, {
      settings: settings(),
      site: { siteUrl: 'https://palscans.test', siteName: 'PALScans' },
      pushSender: sender,
    })
    const pushedTo = sent.map((s) => s.userId).sort((a, b) => a - b)
    expect(pushedTo).toEqual([reader.bookmarkOnly, reader.followAll].sort((a, b) => a - b))
    expect(summary.push.sent).toBe(2)

    const ledger = await db
      .select({
        userId: notificationDeliveries.userId,
        status: notificationDeliveries.status,
        detail: notificationDeliveries.detail,
      })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.channel, 'push'))
    const reasonFor = (id: number) => ledger.find((r) => r.userId === id)
    expect(reasonFor(reader.digestOnly)).toMatchObject({
      status: 'skipped',
      detail: 'series muted',
    })
    expect(reasonFor(reader.mutedButShelved)).toMatchObject({
      status: 'skipped',
      detail: 'series muted',
    })
    expect(reasonFor(reader.inAppOnly)).toMatchObject({ status: 'skipped', detail: 'series muted' })
    expect(reasonFor(reader.pushOffGlobally)).toMatchObject({
      status: 'skipped',
      detail: 'preference off',
    })
  })

  it('is idempotent — a second pass over the same chapter sends nothing', async () => {
    const { sender, sent } = capturingSender()
    await fanoutNewChapter(db, chapterId, {
      settings: settings(),
      site: { siteUrl: 'https://palscans.test', siteName: 'PALScans' },
      pushSender: sender,
    })
    expect(sent).toEqual([])
  })
})

describe('the digest', () => {
  const since = new Date('2026-08-01T00:00:00Z')
  const until = new Date('2026-10-01T00:00:00Z')
  const seriesIdsFor = async (userId: number) =>
    (await collectDigestRows(db, userId, since, until)).map((r) => r.seriesId)

  it('includes a bookmark with no follow row', async () => {
    expect(await seriesIdsFor(reader.bookmarkOnly)).toEqual([seriesId])
  })

  it('includes a series set to digest-only', async () => {
    expect(await seriesIdsFor(reader.digestOnly)).toEqual([seriesId])
  })

  it('includes an explicit follow with no bookmark at all', async () => {
    expect(await seriesIdsFor(reader.followAll)).toEqual([seriesId])
  })

  it('excludes a muted series even though it is still on a shelf', async () => {
    expect(await seriesIdsFor(reader.mutedButShelved)).toEqual([])
  })

  it('excludes a push-only series, which is the point of picking push', async () => {
    expect(await seriesIdsFor(reader.inAppOnly)).toEqual([])
  })

  it('still takes reading progress as a reason to be told', async () => {
    expect(await seriesIdsFor(reader.progressOnly)).toEqual([seriesId])
  })

  it('mutes a series the reader only has progress on, once they say so', async () => {
    await db
      .insert(seriesFollows)
      .values({ userId: reader.progressOnly, seriesId, mode: 'off' })
      .onConflictDoUpdate({
        target: [seriesFollows.userId, seriesFollows.seriesId],
        set: { mode: 'off' },
      })
    expect(await seriesIdsFor(reader.progressOnly)).toEqual([])
    await db.delete(seriesFollows).where(eq(seriesFollows.userId, reader.progressOnly))
  })

  it('says nothing about a series nobody follows', async () => {
    expect(await collectDigestRows(db, reader.followAll, since, until)).not.toContainEqual(
      expect.objectContaining({ seriesId: otherSeriesId }),
    )
  })
})
