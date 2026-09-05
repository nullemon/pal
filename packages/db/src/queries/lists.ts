import { slugify, uniqueSlug } from '@palscans/core'
import type { SQL } from 'drizzle-orm'
import { and, asc, count as countAll, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Db } from '../client.js'
import { readingListItems, readingLists, series, users } from '../schema/index.js'
import { publishedSeries } from './_shared.js'

/**
 * Custom reading lists (docs/13, docs/17 §G). Everything the reader-facing routes need to
 * read and change a list lives here, so the ordering rule and the visibility rule are
 * written once and tested once instead of being re-derived in every route handler.
 */

/** Per account. High enough that nobody sane hits it, low enough that a script cannot flood. */
export const MAX_LISTS_PER_USER = 50
/** Per list. Bounds the dense re-ordering rewrite and the page render. */
export const MAX_ITEMS_PER_LIST = 500
export const MAX_LIST_NAME = 60
export const MAX_LIST_DESCRIPTION = 300

export interface ReadingListSummary {
  id: number
  name: string
  slug: string
  description: string | null
  isPublic: boolean
  itemCount: number
  createdAt: Date
  updatedAt: Date
}

export interface ReadingListOwner {
  id: number
  username: string | null
  displayName: string | null
  avatarKey: string | null
}

export interface ReadingListEntry {
  seriesId: number
  slug: string
  title: string
  type: string
  status: string
  coverKey: string | null
  coverColor: string | null
  chapterCount: number
  ratingAvg: number | null
  ratingCount: number
  lastChapterAt: Date | null
  position: number
  addedAt: Date
}

export interface ReadingListDetail extends ReadingListSummary {
  owner: ReadingListOwner
  items: ReadingListEntry[]
}

export type CreateListResult =
  | { ok: true; list: ReadingListSummary }
  | { ok: false; reason: 'limit' }

export type AddItemResult =
  | { ok: true; position: number }
  | { ok: false; reason: 'full' | 'duplicate' | 'missing_series' }

/**
 * Move `value` to `toIndex`, keeping every other element in its relative order. Pure, so the
 * ordering rule is testable without a database; `moveListItem` is only this plus a write.
 * `toIndex` is clamped, and an unknown `value` leaves the order untouched.
 */
export const moveTo = <T>(order: readonly T[], value: T, toIndex: number): T[] => {
  const from = order.indexOf(value)
  if (from === -1) return [...order]
  const to = Math.min(Math.max(Math.trunc(toIndex), 0), order.length - 1)
  if (to === from) return [...order]
  const next = [...order]
  next.splice(from, 1)
  next.splice(to, 0, value)
  return next
}

const summaryColumns = {
  id: readingLists.id,
  name: readingLists.name,
  slug: readingLists.slug,
  description: readingLists.description,
  isPublic: readingLists.isPublic,
  createdAt: readingLists.createdAt,
  updatedAt: readingLists.updatedAt,
} as const

/** `count(item)` per list in one grouped read rather than one query per row. */
const countsFor = async (db: Db, listIds: readonly number[]): Promise<Map<number, number>> => {
  if (listIds.length === 0) return new Map()
  const rows = await db
    .select({ listId: readingListItems.listId, n: sql<number>`count(*)::int` })
    .from(readingListItems)
    .where(inArray(readingListItems.listId, [...listIds]))
    .groupBy(readingListItems.listId)
  return new Map(rows.map((r) => [r.listId, Number(r.n)]))
}

/** Every list the account owns, newest activity first. */
export const listsForUser = async (db: Db, userId: number): Promise<ReadingListSummary[]> => {
  const rows = await db
    .select(summaryColumns)
    .from(readingLists)
    .where(eq(readingLists.userId, userId))
    .orderBy(desc(readingLists.updatedAt), desc(readingLists.id))
  const counts = await countsFor(
    db,
    rows.map((r) => r.id),
  )
  return rows.map((r) => ({ ...r, itemCount: counts.get(r.id) ?? 0 }))
}

const itemsFor = async (db: Db, listId: number): Promise<ReadingListEntry[]> => {
  const rows = await db
    .select({
      seriesId: series.id,
      slug: series.slug,
      title: series.title,
      type: series.type,
      status: series.status,
      coverKey: series.coverKey,
      coverColor: series.coverColor,
      chapterCount: series.chapterCount,
      ratingAvg: series.ratingAvg,
      ratingCount: series.ratingCount,
      lastChapterAt: series.lastChapterAt,
      position: readingListItems.position,
      addedAt: readingListItems.addedAt,
    })
    .from(readingListItems)
    .innerJoin(series, eq(series.id, readingListItems.seriesId))
    .where(and(eq(readingListItems.listId, listId), isNull(series.deletedAt)))
    .orderBy(asc(readingListItems.position))
  return rows.map((r) => ({
    ...r,
    chapterCount: Number(r.chapterCount),
    ratingCount: Number(r.ratingCount),
  }))
}

const loadDetail = async (db: Db, where: SQL): Promise<ReadingListDetail | null> => {
  const [row] = await db
    .select({
      ...summaryColumns,
      ownerId: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarKey: users.avatarKey,
    })
    .from(readingLists)
    .innerJoin(users, eq(users.id, readingLists.userId))
    .where(where)
    .limit(1)
  if (!row) return null
  const items = await itemsFor(db, row.id)
  const { ownerId, username, displayName, avatarKey, ...list } = row
  return {
    ...list,
    itemCount: items.length,
    owner: { id: ownerId, username, displayName, avatarKey },
    items,
  }
}

/** One list by id, with its owner and ordered items. Visibility is the caller's decision. */
export const readingListById = (db: Db, id: number): Promise<ReadingListDetail | null> =>
  loadDetail(db, eq(readingLists.id, id) as SQL)

/**
 * The shareable URL: `/lists/{username}/{slug}`. Returns the list whoever owns it, so the
 * route can answer 404 for a private list rather than leaking that it exists — the
 * `isPublic` flag on the result is what the caller checks.
 */
export const readingListByOwnerSlug = (
  db: Db,
  username: string,
  slug: string,
): Promise<ReadingListDetail | null> =>
  loadDetail(
    db,
    and(eq(users.username, username), eq(readingLists.slug, slug), isNull(users.deletedAt)) as SQL,
  )

/**
 * Create a list. The slug is derived from the name and de-duplicated against the account's
 * own slugs, because the public URL is scoped to the owner — two readers may both publish
 * `best-of`.
 */
export const createReadingList = async (
  db: Db,
  input: { userId: number; name: string; description?: string | null; isPublic?: boolean },
): Promise<CreateListResult> => {
  const name = input.name.trim().slice(0, MAX_LIST_NAME)
  const taken = await db
    .select({ slug: readingLists.slug })
    .from(readingLists)
    .where(eq(readingLists.userId, input.userId))
  if (taken.length >= MAX_LISTS_PER_USER) return { ok: false, reason: 'limit' }
  const slug = uniqueSlug(
    slugify(name, { fallback: 'list' }),
    taken.map((t) => t.slug),
  )
  const [row] = await db
    .insert(readingLists)
    .values({
      userId: input.userId,
      name,
      slug,
      description: input.description?.trim().slice(0, MAX_LIST_DESCRIPTION) || null,
      isPublic: input.isPublic ?? false,
    })
    .returning(summaryColumns)
  if (!row) return { ok: false, reason: 'limit' }
  return { ok: true, list: { ...row, itemCount: 0 } }
}

/**
 * Rename / re-describe / publish or unpublish. Scoped by `userId` in the WHERE clause, so a
 * request for someone else's list id changes nothing and reports "not found".
 *
 * The slug follows the name: a shared link is a promise about the name on the page, and a
 * renamed list whose URL still says `guilty-pleasures` is worse than a link that breaks.
 */
export const updateReadingList = async (
  db: Db,
  input: {
    id: number
    userId: number
    name?: string
    description?: string | null
    isPublic?: boolean
  },
): Promise<ReadingListSummary | null> => {
  const patch: Partial<typeof readingLists.$inferInsert> = { updatedAt: new Date() }
  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, MAX_LIST_NAME)
    patch.name = name
    const taken = await db
      .select({ id: readingLists.id, slug: readingLists.slug })
      .from(readingLists)
      .where(eq(readingLists.userId, input.userId))
    patch.slug = uniqueSlug(
      slugify(name, { fallback: 'list' }),
      taken.filter((t) => t.id !== input.id).map((t) => t.slug),
    )
  }
  if (input.description !== undefined)
    patch.description = input.description?.trim().slice(0, MAX_LIST_DESCRIPTION) || null
  if (input.isPublic !== undefined) patch.isPublic = input.isPublic
  const [row] = await db
    .update(readingLists)
    .set(patch)
    .where(and(eq(readingLists.id, input.id), eq(readingLists.userId, input.userId)))
    .returning(summaryColumns)
  if (!row) return null
  const counts = await countsFor(db, [row.id])
  return { ...row, itemCount: counts.get(row.id) ?? 0 }
}

export const deleteReadingList = async (
  db: Db,
  input: { id: number; userId: number },
): Promise<boolean> => {
  const rows = await db
    .delete(readingLists)
    .where(and(eq(readingLists.id, input.id), eq(readingLists.userId, input.userId)))
    .returning({ id: readingLists.id })
  return rows.length > 0
}

const touch = (db: Db, listId: number) =>
  db.update(readingLists).set({ updatedAt: new Date() }).where(eq(readingLists.id, listId))

/**
 * Append a series to the end of a list. Only published, live series can be added — a list
 * is a public artefact, and a draft or removed title has no page to link to.
 */
export const addToReadingList = async (
  db: Db,
  input: { listId: number; seriesId: number },
): Promise<AddItemResult> => {
  const [live] = await db
    .select({ id: series.id })
    .from(series)
    .where(and(eq(series.id, input.seriesId), publishedSeries()))
    .limit(1)
  if (!live) return { ok: false, reason: 'missing_series' }
  const [existing] = await db
    .select({ position: readingListItems.position })
    .from(readingListItems)
    .where(
      and(eq(readingListItems.listId, input.listId), eq(readingListItems.seriesId, input.seriesId)),
    )
    .limit(1)
  if (existing) return { ok: false, reason: 'duplicate' }
  const [{ n } = { n: 0 }] = await db
    .select({ n: countAll() })
    .from(readingListItems)
    .where(eq(readingListItems.listId, input.listId))
  const size = Number(n)
  if (size >= MAX_ITEMS_PER_LIST) return { ok: false, reason: 'full' }
  const rows = await db
    .insert(readingListItems)
    .values({ listId: input.listId, seriesId: input.seriesId, position: size })
    .onConflictDoNothing()
    .returning({ position: readingListItems.position })
  if (rows.length === 0) return { ok: false, reason: 'duplicate' }
  await touch(db, input.listId)
  return { ok: true, position: size }
}

/** Remove one series and close the gap, so positions stay dense. */
export const removeFromReadingList = async (
  db: Db,
  input: { listId: number; seriesId: number },
): Promise<boolean> => {
  const removed = await db.transaction(async (tx) => {
    const rows = await tx
      .delete(readingListItems)
      .where(
        and(
          eq(readingListItems.listId, input.listId),
          eq(readingListItems.seriesId, input.seriesId),
        ),
      )
      .returning({ seriesId: readingListItems.seriesId })
    if (rows.length === 0) return false
    await renumber(tx, input.listId)
    return true
  })
  if (removed) await touch(db, input.listId)
  return removed
}

/** Rewrite positions as 0…n-1 in the current order. */
const renumber = async (db: Db, listId: number): Promise<number[]> => {
  const rows = await db
    .select({ seriesId: readingListItems.seriesId })
    .from(readingListItems)
    .where(eq(readingListItems.listId, listId))
    .orderBy(asc(readingListItems.position), asc(readingListItems.seriesId))
  await writeOrder(
    db,
    listId,
    rows.map((r) => r.seriesId),
  )
  return rows.map((r) => r.seriesId)
}

const writeOrder = async (db: Db, listId: number, order: readonly number[]): Promise<void> => {
  for (const [index, seriesId] of order.entries()) {
    await db
      .update(readingListItems)
      .set({ position: index })
      .where(and(eq(readingListItems.listId, listId), eq(readingListItems.seriesId, seriesId)))
  }
}

/**
 * Move one series to `toIndex` (0-based) and rewrite the whole list's positions in one
 * transaction. The order is read inside the transaction, so two concurrent moves cannot
 * interleave into a list with duplicate positions.
 */
export const moveListItem = async (
  db: Db,
  input: { listId: number; seriesId: number; toIndex: number },
): Promise<number[] | null> => {
  const order = await db.transaction(async (tx) => {
    const current = await tx
      .select({ seriesId: readingListItems.seriesId })
      .from(readingListItems)
      .where(eq(readingListItems.listId, input.listId))
      .orderBy(asc(readingListItems.position), asc(readingListItems.seriesId))
    const ids = current.map((r) => r.seriesId)
    if (!ids.includes(input.seriesId)) return null
    const next = moveTo(ids, input.seriesId, input.toIndex)
    await writeOrder(tx, input.listId, next)
    return next
  })
  if (order) await touch(db, input.listId)
  return order
}
