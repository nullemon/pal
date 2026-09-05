import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db, type DbHandle } from '../client.js'
import { runMigrations } from '../migrate.js'
import { series, seriesRequests, seriesRequestVotes, users } from '../schema/index.js'
import {
  createRequest,
  findDuplicateRequest,
  listRequests,
  mergeRequests,
  requestById,
  requestTitleKey,
  searchRequests,
  setRequestStatus,
  unvoteRequest,
  votedRequestIds,
  voteForRequest,
} from './requests.js'
import { searchSeries } from './search.js'

/**
 * Migration 9024 and the request-board rules, against a real Postgres (PGlite). Every claim
 * here is a claim about the *schema* — a unique index, a CHECK, a trigger — or about SQL
 * that only Postgres can answer (trigram similarity), so a mocked database would prove
 * nothing at all.
 */

let dir: string
let handle: DbHandle
let db: Db
const key = (n: number) => new Uint8Array(16).fill(n)
const ids = { reader: 0, other: 0, frost: 0 }

/**
 * The whole error chain of a rejected statement. Drizzle's own message is only the SQL it
 * sent; the constraint that refused it is on `cause`, and the constraint is the thing every
 * test in this file is actually asserting about.
 */
const rejection = async (run: Promise<unknown>): Promise<string> => {
  try {
    await run
  } catch (error) {
    const parts: string[] = []
    for (let e: unknown = error; e instanceof Error; e = e.cause) parts.push(e.message)
    return parts.join(' | ')
  }
  throw new Error('expected the statement to be refused, but it succeeded')
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-requests-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  db = handle.db
  await runMigrations(handle)
  const people = await db
    .insert(users)
    .values([
      { email: 'reader@example.com', username: 'reader' },
      { email: 'other@example.com', username: 'other' },
    ])
    .returning({ id: users.id, username: users.username })
  ids.reader = people.find((u) => u.username === 'reader')?.id ?? 0
  ids.other = people.find((u) => u.username === 'other')?.id ?? 0
  const titles = await db
    .insert(series)
    .values([
      {
        slug: 'return-of-the-frost-monarch',
        title: 'Return of the Frost Monarch',
        type: 'manhwa',
        state: 'published',
      },
    ])
    .returning({ id: series.id })
  ids.frost = titles[0]?.id ?? 0
})

afterAll(async () => {
  await handle.close()
  await rm(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  await db.delete(seriesRequestVotes)
  await db.delete(seriesRequests)
})

describe('the title key', () => {
  it('matches the generated column Postgres computes', async () => {
    const samples = ['Solo Leveling', 'solo-leveling!!', '  SOLO   LEVELING  ', 'Ω Alpha 2']
    for (const title of samples) {
      const [row] = await db
        .insert(seriesRequests)
        .values({ title })
        .onConflictDoNothing()
        .returning({ id: seriesRequests.id, titleKey: seriesRequests.titleKey })
      if (!row) continue
      expect(row.titleKey).toBe(requestTitleKey(title))
      await db.delete(seriesRequests).where(eq(seriesRequests.id, row.id))
    }
  })

  it('is unique, so the same title can never become two rows', async () => {
    await db.insert(seriesRequests).values({ title: 'Solo Leveling' })
    expect(await rejection(db.insert(seriesRequests).values({ title: 'solo-leveling!!' }))).toMatch(
      /series_requests_title_key_uidx/,
    )
  })
})

describe('one vote per person, enforced by the database', () => {
  it('refuses a second row for the same voter key', async () => {
    const [row] = await db
      .insert(seriesRequests)
      .values({ title: 'Omniscient Reader' })
      .returning({ id: seriesRequests.id })
    const id = row?.id ?? 0
    await db.insert(seriesRequestVotes).values({ requestId: id, voterKey: key(1) })
    // Not "the route handler checks first" — the primary key refuses it.
    expect(
      await rejection(db.insert(seriesRequestVotes).values({ requestId: id, voterKey: key(1) })),
    ).toMatch(/series_request_votes_request_id_voter_key_pk/)
    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(seriesRequestVotes)
      .where(eq(seriesRequestVotes.requestId, id))
    expect(Number(count?.n)).toBe(1)
  })

  it('refuses the same account voting under a second key', async () => {
    const [row] = await db
      .insert(seriesRequests)
      .values({ title: 'Nano Machine' })
      .returning({ id: seriesRequests.id })
    const id = row?.id ?? 0
    await db
      .insert(seriesRequestVotes)
      .values({ requestId: id, voterKey: key(2), userId: ids.reader })
    expect(
      await rejection(
        db
          .insert(seriesRequestVotes)
          .values({ requestId: id, voterKey: key(3), userId: ids.reader }),
      ),
    ).toMatch(/series_request_votes_user_uidx/)
  })

  it('lets different people vote, and keeps vote_count in step through the trigger', async () => {
    const created = await createRequest(db, { title: 'Tower of God', voterKey: key(4) })
    expect(created.ok).toBe(true)
    const id = created.ok ? created.request.id : 0
    expect(created.ok && created.request.voteCount).toBe(1)

    await voteForRequest(db, { requestId: id, voterKey: key(5) })
    await voteForRequest(db, { requestId: id, voterKey: key(6), userId: ids.other })
    // the same person twice: accepted, counted once
    const again = await voteForRequest(db, { requestId: id, voterKey: key(5) })
    expect(again).toEqual({ ok: true, voted: true, voteCount: 3 })
    expect((await requestById(db, id))?.voteCount).toBe(3)

    await unvoteRequest(db, { requestId: id, voterKey: key(5) })
    expect((await requestById(db, id))?.voteCount).toBe(2)
  })

  it('reports back which rows the viewer has voted for', async () => {
    const a = await createRequest(db, { title: 'Eleceed', voterKey: key(7) })
    const b = await createRequest(db, { title: 'Jujutsu Kaisen', voterKey: key(8) })
    const aId = a.ok ? a.request.id : 0
    const bId = b.ok ? b.request.id : 0
    const voted = await votedRequestIds(db, [aId, bId], { voterKey: key(7) })
    expect([...voted]).toEqual([aId])
    expect([...(await votedRequestIds(db, [aId, bId], {}))]).toEqual([])
  })
})

describe('search before you post', () => {
  beforeEach(async () => {
    await createRequest(db, {
      title: 'Solo Leveling',
      altTitles: ['Na Honjaman Level Up', 'Only I Level Up'],
      voterKey: key(9),
    })
    await createRequest(db, { title: 'The Beginning After The End', voterKey: key(10) })
  })

  it('finds an existing request by an exact, a cased and a punctuated title', async () => {
    for (const q of ['Solo Leveling', 'solo leveling', 'SOLO-LEVELING!']) {
      const hit = await findDuplicateRequest(db, q)
      expect(hit?.title).toBe('Solo Leveling')
    }
  })

  it('catches a near miss a unique index never would', async () => {
    const hit = await findDuplicateRequest(db, 'Solo Levelling')
    expect(hit?.title).toBe('Solo Leveling')
  })

  it('finds a request by an alternative title the requester supplied', async () => {
    const hits = await searchRequests(db, 'Na Honjaman Level Up')
    expect(hits[0]?.title).toBe('Solo Leveling')
  })

  it('does not call unrelated titles duplicates', async () => {
    expect(await findDuplicateRequest(db, 'Omniscient Reader')).toBeNull()
    expect(await searchRequests(db, 'a')).toEqual([])
  })

  it('refuses a duplicate submission and hands back the row to upvote', async () => {
    const result = await createRequest(db, { title: 'solo leveling', voterKey: key(11) })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe('duplicate')
    expect(!result.ok && result.existing.title).toBe('Solo Leveling')
    const page = await listRequests(db, { filter: 'all' })
    expect(page.items.filter((r) => r.title === 'Solo Leveling')).toHaveLength(1)
  })

  it('searches the catalogue with the one series search this codebase has', async () => {
    const hits = await searchSeries(db, 'frost monarch')
    expect(hits[0]?.slug).toBe('return-of-the-frost-monarch')
  })
})

describe('triage', () => {
  it('refuses to mark a request added without the series that fulfils it', async () => {
    const created = await createRequest(db, { title: 'Kaiju No. 8' })
    const id = created.ok ? created.request.id : 0
    expect(
      await rejection(
        db.update(seriesRequests).set({ status: 'added' }).where(eq(seriesRequests.id, id)),
      ),
    ).toMatch(/series_requests_fulfilled_check/)
  })

  it('closes the loop with a link to the series', async () => {
    const created = await createRequest(db, { title: 'Frost Monarch' })
    const id = created.ok ? created.request.id : 0
    const row = await setRequestStatus(db, {
      id,
      status: 'added',
      seriesId: ids.frost,
      actorId: ids.reader,
    })
    expect(row?.status).toBe('added')
    expect(row?.seriesSlug).toBe('return-of-the-frost-monarch')
    expect(row?.resolvedAt).toBeInstanceOf(Date)
  })

  it('keeps a decline reason and clears it when the row is reopened', async () => {
    const created = await createRequest(db, { title: 'Something Licensed' })
    const id = created.ok ? created.request.id : 0
    const declined = await setRequestStatus(db, {
      id,
      status: 'declined',
      declineReason: 'Licensed in English.',
      actorId: ids.reader,
    })
    expect(declined?.declineReason).toBe('Licensed in English.')
    const reopened = await setRequestStatus(db, { id, status: 'open', actorId: ids.reader })
    expect(reopened?.declineReason).toBeNull()
    expect(reopened?.resolvedAt).toBeNull()
  })

  it('merges duplicates without double-counting the person who voted for both', async () => {
    const a = await createRequest(db, { title: 'Nano Machine', voterKey: key(12) })
    const b = await createRequest(db, { title: 'Nanomachine Reborn', voterKey: key(13) })
    const aId = a.ok ? a.request.id : 0
    const bId = b.ok ? b.request.id : 0
    // one person voted for both, one only for the loser
    await voteForRequest(db, { requestId: aId, voterKey: key(13) })
    await voteForRequest(db, { requestId: bId, voterKey: key(14) })
    expect((await requestById(db, aId))?.voteCount).toBe(2)
    expect((await requestById(db, bId))?.voteCount).toBe(2)

    const merged = await mergeRequests(db, bId, aId)
    expect(merged.ok).toBe(true)
    // 2 + 2 votes from 3 distinct people
    expect(merged.ok && merged.target.voteCount).toBe(3)
    const board = await listRequests(db, { filter: 'all' })
    expect(board.items.map((r) => r.id)).not.toContain(bId)
    // a vote cast on the merged row lands on the survivor
    await voteForRequest(db, { requestId: bId, voterKey: key(15) })
    expect((await requestById(db, aId))?.voteCount).toBe(4)
    expect((await requestById(db, bId))?.voteCount).toBe(0)
  })

  it('sorts by most wanted and by newest', async () => {
    const wanted = await createRequest(db, { title: 'Wanted', voterKey: key(16) })
    await voteForRequest(db, { requestId: wanted.ok ? wanted.request.id : 0, voterKey: key(17) })
    await createRequest(db, { title: 'Newer', voterKey: key(18) })
    expect((await listRequests(db, { sort: 'votes' })).items.map((r) => r.title)).toEqual([
      'Wanted',
      'Newer',
    ])
    expect((await listRequests(db, { sort: 'new' })).items[0]?.title).toBe('Newer')
  })

  it('filters the board by status', async () => {
    const created = await createRequest(db, { title: 'Planned Thing' })
    await createRequest(db, { title: 'Open Thing' })
    await setRequestStatus(db, {
      id: created.ok ? created.request.id : 0,
      status: 'planned',
      actorId: ids.reader,
    })
    expect((await listRequests(db, { filter: 'open' })).items.map((r) => r.title)).toEqual([
      'Open Thing',
    ])
    expect((await listRequests(db, { filter: 'planned' })).items.map((r) => r.title)).toEqual([
      'Planned Thing',
    ])
    expect((await listRequests(db, { filter: 'all' })).total).toBe(2)
  })

  it('keeps the anonymous requester key out of any list the public board reads', async () => {
    await createRequest(db, { title: 'Anonymous Ask', requesterKey: key(19) })
    const page = await listRequests(db, { filter: 'all' })
    expect(page.items[0]).not.toHaveProperty('requesterKey')
    const [stored] = await db
      .select({ k: seriesRequests.requesterKey })
      .from(seriesRequests)
      .where(and(eq(seriesRequests.title, 'Anonymous Ask')))
    expect(stored?.k).toEqual(key(19))
  })
})
