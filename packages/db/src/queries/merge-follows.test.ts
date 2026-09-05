import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createDb, type Db, type DbHandle } from '../client.js'
import { runMigrations } from '../migrate.js'
import { bookmarks, series, seriesFollows, users } from '../schema/index.js'
import { followState } from './follows.js'
import { mergeSeries } from './merge.js'

/**
 * A merge rewrites every reader association on the losing series. `series_follows` is the
 * newest of them and the one a reader notices going wrong: a follow is the subscription
 * itself, and a `mode: 'off'` row is somebody who deliberately unsubscribed while keeping
 * the series on a shelf. Losing either is silent — no error, no notification, nothing the
 * operator sees in the preview.
 */
let handle: DbHandle
let db: Db
let winner = 0
let loser = 0
const reader = { followOnly: 0, mutedButShelved: 0, actor: 0 }

beforeAll(async () => {
  handle = await createDb('pglite://memory')
  await runMigrations(handle)
  db = handle.db
  const made = await db
    .insert(users)
    .values(
      (Object.keys(reader) as Array<keyof typeof reader>).map((n) => ({
        email: `${n}@merge.test`,
        username: n.toLowerCase(),
      })),
    )
    .returning({ id: users.id })
  ;(Object.keys(reader) as Array<keyof typeof reader>).forEach((n, i) => {
    const row = made[i]
    if (!row) throw new Error('user not inserted')
    reader[n] = row.id
  })
  const [w, l] = await db
    .insert(series)
    .values([
      { slug: 'winner', title: 'Winner', type: 'manga', state: 'published' },
      { slug: 'loser', title: 'Loser', type: 'manga', state: 'published' },
    ])
    .returning({ id: series.id })
  if (!w || !l) throw new Error('series not inserted')
  winner = w.id
  loser = l.id

  // Followed it without bookmarking — the exact case follows were added for.
  await db.insert(seriesFollows).values({ userId: reader.followOnly, seriesId: loser, mode: 'all' })
  // Kept it on a shelf but deliberately muted it.
  await db
    .insert(bookmarks)
    .values({ userId: reader.mutedButShelved, seriesId: loser, status: 'completed' })
  await db
    .insert(seriesFollows)
    .values({ userId: reader.mutedButShelved, seriesId: loser, mode: 'off' })
}, 180_000)

afterAll(async () => {
  await handle.close()
})

it('carries follows and mutes across a merge', async () => {
  const res = await mergeSeries(db, { winnerId: winner, loserId: loser, actorId: reader.actor })
  expect(res.ok, JSON.stringify(res)).toBe(true)

  // 1. The follow-only reader must still be subscribed to the surviving series.
  const kept = await followState(db, reader.followOnly, winner)
  expect(kept?.mode, 'a reader who followed without bookmarking lost their subscription').toBe(
    'all',
  )

  // 2. The muted reader must stay muted. Their bookmark moves; if the mute does not follow
  //    it, `mergeFollowers` reads the orphaned bookmark as an implicit follow on `all` and
  //    the merge re-subscribes somebody who deliberately unsubscribed.
  const muted = await followState(db, reader.mutedButShelved, winner)
  expect(muted?.mode, 'a deliberate mute was lost, re-subscribing the reader').toBe('off')

  // 3. Nothing left pointing at the retired series.
  const left = await db.select().from(seriesFollows).where(eq(seriesFollows.seriesId, loser))
  expect(left.length, 'follow rows still point at the retired series').toBe(0)
})
