import 'server-only'
import { type Db, getDb, people, seriesPeople } from '@palscans/db'
import { count, desc, eq, sql } from 'drizzle-orm'

/**
 * Authors and artists.
 *
 * Only a search endpoint existed, for the series editor's autocomplete — nothing could list,
 * rename or merge. That was survivable while every person was typed by hand and becomes a
 * problem the moment the AniList importer runs: it creates a row per credit, so the same
 * human arrives as "ONE" and "One", or "Yusuke Murata" and "Murata Yusuke", and each spelling
 * splits that person's series across two entries. Nothing ever removed one, so the damage
 * accumulates with every import and there was no way back.
 */

export interface PersonRow {
  id: number
  slug: string
  name: string
  seriesCount: number
}

export const listPeople = async (query: string | null, db?: Db): Promise<PersonRow[]> => {
  const database = db ?? (await getDb())
  const rows = await database
    .select({
      id: people.id,
      slug: people.slug,
      name: people.name,
      seriesCount: count(seriesPeople.seriesId),
    })
    .from(people)
    .leftJoin(seriesPeople, eq(seriesPeople.personId, people.id))
    .where(query ? sql`${people.name} ILIKE ${`%${query}%`}` : sql`true`)
    .groupBy(people.id)
    .orderBy(desc(count(seriesPeople.seriesId)), people.name)
    .limit(500)
  return rows
}

/**
 * Rename. The slug is left alone deliberately — it is how the person is addressed elsewhere,
 * and a rename here is nearly always a spelling correction rather than a different human.
 */
export const renamePerson = async (id: number, name: string, db?: Db): Promise<boolean> => {
  const database = db ?? (await getDb())
  const result = await database
    .update(people)
    .set({ name })
    .where(eq(people.id, id))
    .returning({ id: people.id })
  return result.length > 0
}

export interface MergePreview {
  winner: PersonRow
  loser: PersonRow
  /** Credits that move, after the ones the winner already holds are discarded. */
  moved: number
}

/**
 * Fold `loserId` into `winnerId`: every series credited to the loser becomes credited to the
 * winner, and the loser is deleted.
 *
 * `series_people` is keyed on `(series_id, person_id, credit)`, so a plain UPDATE of
 * `person_id` collides whenever the series already credits the winner in the same role —
 * which is exactly the case a merge exists for, since that is what a duplicate looks like.
 * The rows are therefore inserted with the conflict ignored and the loser's deleted after,
 * inside one transaction: a merge that half-applied would leave a series crediting one
 * spelling for `author` and the other for `artist`, which is worse than the duplicate.
 */
export const mergePeople = async (
  winnerId: number,
  loserId: number,
  db?: Db,
): Promise<{ moved: number } | null> => {
  if (winnerId === loserId) return null
  const database = db ?? (await getDb())
  return database.transaction(async (tx) => {
    const [winner] = await tx.select().from(people).where(eq(people.id, winnerId)).limit(1)
    const [loser] = await tx.select().from(people).where(eq(people.id, loserId)).limit(1)
    if (!winner || !loser) return null

    const rows = await tx
      .select({ seriesId: seriesPeople.seriesId, credit: seriesPeople.credit })
      .from(seriesPeople)
      .where(eq(seriesPeople.personId, loserId))
    if (rows.length)
      await tx
        .insert(seriesPeople)
        .values(rows.map((r) => ({ seriesId: r.seriesId, personId: winnerId, credit: r.credit })))
        .onConflictDoNothing()
    await tx.delete(seriesPeople).where(eq(seriesPeople.personId, loserId))
    await tx.delete(people).where(eq(people.id, loserId))
    return { moved: rows.length }
  })
}

/**
 * Candidate duplicates: people whose names differ only by case, spacing or word order.
 *
 * Deliberately suggestions, never automatic. "Kubo Tite" and "Tite Kubo" are one person;
 * "Ryu Ki-Woon" and "Ryu Ki-Woong" may well be two, and a merge cannot be undone — the loser
 * is gone and its credits are indistinguishable from the winner's own.
 */
export const duplicateCandidates = async (db?: Db): Promise<Array<[PersonRow, PersonRow]>> => {
  const rows = await listPeople(null, db)
  const key = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .sort()
      .join(' ')
  const byKey = new Map<string, PersonRow[]>()
  for (const row of rows) {
    const k = key(row.name)
    if (!k) continue
    byKey.set(k, [...(byKey.get(k) ?? []), row])
  }
  const pairs: Array<[PersonRow, PersonRow]> = []
  for (const group of byKey.values()) {
    if (group.length < 2) continue
    // The one with more series is offered as the winner, since it is the spelling the
    // catalogue already leans on.
    const [first, ...rest] = [...group].sort((a, b) => b.seriesCount - a.seriesCount)
    for (const other of rest) if (first) pairs.push([first, other])
  }
  return pairs.slice(0, 100)
}
