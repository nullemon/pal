import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { eq, like } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db, type DbHandle } from '../client.js'
import { runMigrations } from '../migrate.js'
import { readingListItems, readingLists, series, users } from '../schema/index.js'
import {
  addToReadingList,
  createReadingList,
  deleteReadingList,
  listsForUser,
  MAX_ITEMS_PER_LIST,
  moveListItem,
  moveTo,
  readingListById,
  readingListByOwnerSlug,
  removeFromReadingList,
  updateReadingList,
} from './lists.js'

/**
 * Migration 9018 and the reading-list rules against a real Postgres (PGlite): ordering,
 * membership, and who may see a list. These are properties of the schema and of the SQL in
 * `queries/lists.ts`, so a mocked database would prove nothing about them.
 */

let dir: string
let handle: DbHandle
let db: Db
const ids = { owner: 0, other: 0, alpha: 0, beta: 0, gamma: 0, draft: 0, deleted: 0 }

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-lists-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  db = handle.db
  await runMigrations(handle)
  const people = await db
    .insert(users)
    .values([
      { email: 'owner@example.com', username: 'owner' },
      { email: 'other@example.com', username: 'other' },
    ])
    .returning({ id: users.id, username: users.username })
  ids.owner = people.find((u) => u.username === 'owner')?.id ?? 0
  ids.other = people.find((u) => u.username === 'other')?.id ?? 0
  const titles = await db
    .insert(series)
    .values([
      { slug: 'alpha', title: 'Alpha', type: 'manhwa', state: 'published' },
      { slug: 'beta', title: 'Beta', type: 'manhwa', state: 'published' },
      { slug: 'gamma', title: 'Gamma', type: 'manga', state: 'published' },
      { slug: 'draft', title: 'Draft', type: 'manga', state: 'draft' },
      {
        slug: 'gone',
        title: 'Gone',
        type: 'manga',
        state: 'published',
        deletedAt: new Date(),
      },
    ])
    .returning({ id: series.id, slug: series.slug })
  for (const row of titles) {
    if (row.slug === 'alpha') ids.alpha = row.id
    if (row.slug === 'beta') ids.beta = row.id
    if (row.slug === 'gamma') ids.gamma = row.id
    if (row.slug === 'draft') ids.draft = row.id
    if (row.slug === 'gone') ids.deleted = row.id
  }
})

afterAll(async () => {
  await handle.close()
  await rm(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  await db.delete(readingListItems)
  await db.delete(readingLists)
})

const newList = async (name = 'Best of 2026', userId = ids.owner) => {
  const created = await createReadingList(db, { userId, name })
  if (!created.ok) throw new Error(`create failed: ${created.reason}`)
  return created.list
}

const eqId = (id: number) => eq(series.id, id)

const orderOf = async (listId: number) =>
  (await readingListById(db, listId))?.items.map((i) => i.slug) ?? []

describe('moveTo', () => {
  it('moves an element and keeps the rest in order', () => {
    expect(moveTo(['a', 'b', 'c', 'd'], 'a', 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveTo(['a', 'b', 'c', 'd'], 'd', 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveTo(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'b', 'c'])
  })

  it('clamps an out-of-range index and ignores an unknown element', () => {
    expect(moveTo(['a', 'b', 'c'], 'a', 99)).toEqual(['b', 'c', 'a'])
    expect(moveTo(['a', 'b', 'c'], 'c', -5)).toEqual(['c', 'a', 'b'])
    expect(moveTo(['a', 'b', 'c'], 'z', 0)).toEqual(['a', 'b', 'c'])
  })
})

describe('creating lists', () => {
  it('derives a slug from the name and keeps it unique within the account', async () => {
    const first = await newList('Best of 2026')
    const second = await newList('Best of 2026')
    expect(first.slug).toBe('best-of-2026')
    expect(second.slug).toBe('best-of-2026-2')
    expect(first.isPublic).toBe(false)
  })

  it('lets two accounts use the same slug, because the URL carries the owner', async () => {
    const mine = await newList('Comfort reads', ids.owner)
    const theirs = await newList('Comfort reads', ids.other)
    expect(mine.slug).toBe(theirs.slug)
  })

  it('renaming moves the slug with the name and frees the old one', async () => {
    const list = await newList('Comfort reads')
    const renamed = await updateReadingList(db, {
      id: list.id,
      userId: ids.owner,
      name: 'Guilty pleasures',
    })
    expect(renamed?.slug).toBe('guilty-pleasures')
    expect(await readingListByOwnerSlug(db, 'owner', 'comfort-reads')).toBeNull()
  })
})

describe('membership', () => {
  it('adds to the end and refuses the same series twice', async () => {
    const list = await newList()
    expect(await addToReadingList(db, { listId: list.id, seriesId: ids.alpha })).toEqual({
      ok: true,
      position: 0,
    })
    expect(await addToReadingList(db, { listId: list.id, seriesId: ids.beta })).toEqual({
      ok: true,
      position: 1,
    })
    expect(await addToReadingList(db, { listId: list.id, seriesId: ids.alpha })).toEqual({
      ok: false,
      reason: 'duplicate',
    })
    expect(await orderOf(list.id)).toEqual(['alpha', 'beta'])
  })

  it('refuses a series that is not published or has been removed', async () => {
    const list = await newList()
    expect(await addToReadingList(db, { listId: list.id, seriesId: ids.draft })).toEqual({
      ok: false,
      reason: 'missing_series',
    })
    expect(await addToReadingList(db, { listId: list.id, seriesId: ids.deleted })).toEqual({
      ok: false,
      reason: 'missing_series',
    })
    expect(await orderOf(list.id)).toEqual([])
  })

  it('hides a series that is soft-deleted after it was added', async () => {
    const list = await newList()
    await addToReadingList(db, { listId: list.id, seriesId: ids.alpha })
    await addToReadingList(db, { listId: list.id, seriesId: ids.beta })
    await db.update(series).set({ deletedAt: new Date() }).where(eqId(ids.beta))
    expect(await orderOf(list.id)).toEqual(['alpha'])
    await db.update(series).set({ deletedAt: null }).where(eqId(ids.beta))
  })

  it('removing closes the gap so positions stay dense', async () => {
    const list = await newList()
    for (const id of [ids.alpha, ids.beta, ids.gamma])
      await addToReadingList(db, { listId: list.id, seriesId: id })
    expect(await removeFromReadingList(db, { listId: list.id, seriesId: ids.alpha })).toBe(true)
    expect(await removeFromReadingList(db, { listId: list.id, seriesId: ids.alpha })).toBe(false)
    const detail = await readingListById(db, list.id)
    expect(detail?.items.map((i) => [i.slug, i.position])).toEqual([
      ['beta', 0],
      ['gamma', 1],
    ])
    expect(detail?.itemCount).toBe(2)
  })

  it('keeps two lists that hold the same series apart', async () => {
    const mine = await newList('One')
    const theirs = await newList('Theirs', ids.other)
    await addToReadingList(db, { listId: mine.id, seriesId: ids.alpha })
    await addToReadingList(db, { listId: theirs.id, seriesId: ids.alpha })
    expect(await orderOf(mine.id)).toEqual(['alpha'])
    expect(await orderOf(theirs.id)).toEqual(['alpha'])
    expect((await readingListById(db, mine.id))?.owner.username).toBe('owner')
  })

  it('deleting a list takes its items with it', async () => {
    const list = await newList()
    await addToReadingList(db, { listId: list.id, seriesId: ids.alpha })
    expect(await deleteReadingList(db, { id: list.id, userId: ids.other })).toBe(false)
    expect(await deleteReadingList(db, { id: list.id, userId: ids.owner })).toBe(true)
    expect(await db.select().from(readingListItems)).toHaveLength(0)
  })

  it('caps a list at MAX_ITEMS_PER_LIST', async () => {
    const list = await newList()
    // A full list needs MAX_ITEMS_PER_LIST distinct series, because the primary key is what
    // enforces "a series appears once". Filled directly: the cap is under test, not the
    // round trips.
    const filler = await db
      .insert(series)
      .values(
        Array.from({ length: MAX_ITEMS_PER_LIST }, (_, i) => ({
          slug: `filler-${i}`,
          title: `Filler ${i}`,
          type: 'manhwa' as const,
          state: 'published' as const,
        })),
      )
      .returning({ id: series.id })
    await db.insert(readingListItems).values(
      filler.map((row, i) => ({
        listId: list.id,
        seriesId: row.id,
        position: i,
      })),
    )
    expect(await addToReadingList(db, { listId: list.id, seriesId: ids.gamma })).toEqual({
      ok: false,
      reason: 'full',
    })
    await db.delete(series).where(like(series.slug, 'filler-%'))
  })
})

describe('ordering', () => {
  it('moves an item and renumbers the whole list', async () => {
    const list = await newList()
    for (const id of [ids.alpha, ids.beta, ids.gamma])
      await addToReadingList(db, { listId: list.id, seriesId: id })
    expect(await moveListItem(db, { listId: list.id, seriesId: ids.gamma, toIndex: 0 })).toEqual([
      ids.gamma,
      ids.alpha,
      ids.beta,
    ])
    const detail = await readingListById(db, list.id)
    expect(detail?.items.map((i) => [i.slug, i.position])).toEqual([
      ['gamma', 0],
      ['alpha', 1],
      ['beta', 2],
    ])
  })

  it('clamps a move past the end and reports an unknown series', async () => {
    const list = await newList()
    for (const id of [ids.alpha, ids.beta])
      await addToReadingList(db, { listId: list.id, seriesId: id })
    await moveListItem(db, { listId: list.id, seriesId: ids.alpha, toIndex: 99 })
    expect(await orderOf(list.id)).toEqual(['beta', 'alpha'])
    expect(await moveListItem(db, { listId: list.id, seriesId: ids.gamma, toIndex: 0 })).toBeNull()
  })
})

describe('visibility', () => {
  it('a list is private until it is published, and the URL is owner + slug', async () => {
    const list = await newList('Comfort reads')
    expect(await readingListByOwnerSlug(db, 'owner', 'comfort-reads')).toMatchObject({
      isPublic: false,
    })
    expect((await listsForUser(db, ids.owner)).map((l) => l.isPublic)).toEqual([false])
    await updateReadingList(db, { id: list.id, userId: ids.owner, isPublic: true })
    expect(await readingListByOwnerSlug(db, 'owner', 'comfort-reads')).toMatchObject({
      isPublic: true,
      owner: { username: 'owner' },
    })
    expect((await listsForUser(db, ids.owner)).map((l) => l.isPublic)).toEqual([true])
    // The same slug under the wrong owner is a different list, and there is none.
    expect(await readingListByOwnerSlug(db, 'other', 'comfort-reads')).toBeNull()
  })

  it('the slug lookup is case-insensitive', async () => {
    await newList('Comfort reads')
    expect(await readingListByOwnerSlug(db, 'OWNER', 'Comfort-Reads')).not.toBeNull()
  })

  it('refuses to change a list the account does not own', async () => {
    const list = await newList()
    expect(
      await updateReadingList(db, { id: list.id, userId: ids.other, isPublic: true }),
    ).toBeNull()
    expect(await readingListById(db, list.id)).toMatchObject({ isPublic: false })
  })

  it('lists the account own shelves newest activity first, with counts', async () => {
    const first = await newList('One')
    const second = await newList('Two')
    await addToReadingList(db, { listId: first.id, seriesId: ids.alpha })
    const mine = await listsForUser(db, ids.owner)
    expect(mine.map((l) => l.name)).toEqual(['One', 'Two'])
    expect(mine.map((l) => l.itemCount)).toEqual([1, 0])
    expect(second.id).toBeGreaterThan(0)
    expect(await listsForUser(db, ids.other)).toEqual([])
  })
})
