import type {
  MappedBookmark,
  MappedComment,
  MappedSeries,
  MappedTerm,
  MappedUser,
  RedirectRow,
} from '@palscans/core/import'
import {
  bookmarks,
  comments,
  type Db,
  genres,
  people,
  redirects,
  series,
  seriesGenres,
  seriesPeople,
  seriesTitles,
  users,
} from '@palscans/db'
import { and, eq, isNull, sql } from 'drizzle-orm'

/**
 * The write half of the importer (docs/09, docs/17 §E). Each function takes one mapped row
 * and returns the local id, inserting or updating as needed. They are deliberately small and
 * transaction-agnostic: the runner calls them inside its per-batch transaction, so a batch
 * either lands whole or not at all.
 */

/** `wp-manga-genre` / `-tag` land in `genres`; `-release` is a year, not a genre, and is dropped. */
const GENRE_KIND: Partial<Record<MappedTerm['role'], string>> = { genre: 'genre', tag: 'theme' }

/** Upsert a genre by slug and return its id, or null when the term is not a genre at all. */
export const ensureGenre = async (tx: Db, term: MappedTerm): Promise<number | null> => {
  const kind = GENRE_KIND[term.role]
  if (!kind) return null
  const [row] = await tx
    .insert(genres)
    .values({ slug: term.slug, name: term.name, kind })
    .onConflictDoUpdate({ target: genres.slug, set: { name: term.name } })
    .returning({ id: genres.id })
  return row?.id ?? null
}

/** Upsert an author / artist by slug and return its id. */
export const ensurePerson = async (tx: Db, term: MappedTerm): Promise<number | null> => {
  if (term.role !== 'author' && term.role !== 'artist') return null
  const [row] = await tx
    .insert(people)
    .values({ slug: term.slug, name: term.name })
    .onConflictDoUpdate({ target: people.slug, set: { name: term.name } })
    .returning({ id: people.id })
  return row?.id ?? null
}

const asDate = (iso: string | null): Date | null => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Upsert one series. `existingId` comes from `import_map`; without it the slug is tried, and
 * a slug already held by a *different* series is suffixed with the legacy id rather than
 * silently overwriting a row this import does not own.
 */
export const writeSeries = async (
  tx: Db,
  m: MappedSeries,
  existingId: number | null,
): Promise<number> => {
  const values = {
    title: m.title,
    type: m.type,
    status: m.status,
    state: m.state,
    synopsis: m.synopsis,
    releasedYear: m.releasedYear,
    viewCount: m.viewCount,
    ratingCount: m.ratingCount,
    ratingSum: m.ratingSum,
    publishedAt: asDate(m.publishedAt),
    deletedAt: m.deleted ? (asDate(m.publishedAt) ?? new Date()) : null,
  }

  let id = existingId
  if (id === null) {
    const [bySlug] = await tx
      .select({ id: series.id })
      .from(series)
      .where(eq(series.slug, m.slug))
      .limit(1)
    if (bySlug) id = bySlug.id
  }

  if (id !== null) {
    await tx.update(series).set(values).where(eq(series.id, id))
  } else {
    const [inserted] = await tx
      .insert(series)
      .values({ slug: m.slug, ...values })
      .onConflictDoNothing({ target: series.slug })
      .returning({ id: series.id })
    if (inserted) id = inserted.id
    else {
      // The slug was taken between the check and the insert; keep both rows distinguishable.
      const [fallback] = await tx
        .insert(series)
        .values({ slug: `${m.slug}-${m.legacyId}`, ...values })
        .returning({ id: series.id })
      if (!fallback) throw new Error(`could not insert series ${m.slug}`)
      id = fallback.id
    }
  }

  // Alternative titles: replaced wholesale, because the legacy list is the source of truth.
  await tx.delete(seriesTitles).where(eq(seriesTitles.seriesId, id))
  const alts = [...new Set(m.altTitles.map((t) => t.trim()).filter((t) => t !== ''))]
  if (alts.length)
    await tx
      .insert(seriesTitles)
      .values(alts.map((title) => ({ seriesId: id as number, title })))
      .onConflictDoNothing()

  await tx.delete(seriesGenres).where(eq(seriesGenres.seriesId, id))
  for (const term of m.genres) {
    const genreId = await ensureGenre(tx, term)
    if (genreId !== null)
      await tx.insert(seriesGenres).values({ seriesId: id, genreId }).onConflictDoNothing()
  }

  await tx.delete(seriesPeople).where(eq(seriesPeople.seriesId, id))
  for (const p of m.people) {
    const personId = await ensurePerson(tx, { slug: p.slug, name: p.name, role: p.credit })
    if (personId !== null)
      await tx
        .insert(seriesPeople)
        .values({ seriesId: id, personId, credit: p.credit })
        .onConflictDoNothing()
  }

  return id
}

/**
 * Upsert one reader. The legacy phpass hash is never converted (docs/09), so the account
 * lands with no password and its owner signs in through the reset mail — that is why
 * `passwordHash` is left null instead of being filled with something unusable.
 */
export const writeUser = async (
  tx: Db,
  m: MappedUser,
  existingId: number | null,
): Promise<number> => {
  const values = {
    displayName: m.displayName,
    role: m.role,
    emailVerifiedAt: asDate(m.emailVerifiedAt),
  }
  if (existingId !== null) {
    await tx.update(users).set(values).where(eq(users.id, existingId))
    return existingId
  }
  const [byEmail] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, m.email))
    .limit(1)
  if (byEmail) {
    await tx.update(users).set(values).where(eq(users.id, byEmail.id))
    return byEmail.id
  }
  // Usernames are unique; a legacy collision with an existing account gets a suffix rather
  // than failing the whole batch.
  const [taken] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, m.username))
    .limit(1)
  const username = taken ? `${m.username}-${m.legacyId}`.slice(0, 30) : m.username
  const [row] = await tx
    .insert(users)
    .values({
      email: m.email,
      username,
      passwordHash: null,
      createdAt: asDate(m.createdAt) ?? new Date(),
      ...values,
    })
    .returning({ id: users.id })
  if (!row) throw new Error(`could not insert user ${m.email}`)
  return row.id
}

export const writeBookmark = async (
  tx: Db,
  m: MappedBookmark,
  userId: number,
  seriesId: number,
): Promise<void> => {
  await tx
    .insert(bookmarks)
    .values({ userId, seriesId, status: m.status, createdAt: asDate(m.createdAt) ?? new Date() })
    .onConflictDoUpdate({
      target: [bookmarks.userId, bookmarks.seriesId],
      set: { status: m.status },
    })
}

/**
 * Upsert one comment. Legacy replies are threaded by `comment_parent`, which the runner has
 * already resolved to a local id — an unresolved parent lands the reply at the top level
 * rather than dropping it.
 */
export const writeComment = async (
  tx: Db,
  m: MappedComment,
  ids: { userId: number; seriesId: number; parentId: number | null },
  existingId: number | null,
): Promise<number> => {
  const values = {
    body: m.body,
    status: m.status,
    parentId: ids.parentId,
    hasLink: JSON.stringify(m.body).includes('"link"'),
  }
  if (existingId !== null) {
    await tx.update(comments).set(values).where(eq(comments.id, existingId))
    return existingId
  }
  const [row] = await tx
    .insert(comments)
    .values({
      userId: ids.userId,
      seriesId: ids.seriesId,
      createdAt: asDate(m.createdAt) ?? new Date(),
      ...values,
    })
    .returning({ id: comments.id })
  if (!row) throw new Error(`could not insert comment ${m.legacyId}`)
  return row.id
}

/**
 * Insert redirect rows, skipping any path an operator already created by hand — the
 * importer never overwrites a redirect it did not write.
 */
export const writeRedirects = async (tx: Db, rows: readonly RedirectRow[]): Promise<number> => {
  if (rows.length === 0) return 0
  const inserted = await tx
    .insert(redirects)
    .values(rows.map((r) => ({ fromPath: r.fromPath, toPath: r.toPath, status: r.status })))
    .onConflictDoNothing({ target: redirects.fromPath })
    .returning({ id: redirects.id })
  return inserted.length
}

/** Series counters are trigger-maintained; the import refreshes `last_chapter_at` explicitly. */
export const refreshSeriesRecency = async (tx: Db, seriesId: number): Promise<void> => {
  await tx
    .update(series)
    .set({
      lastChapterAt: sql`(select max(published_at) from chapters where series_id = ${seriesId} and state = 'published' and deleted_at is null)`,
    })
    .where(and(eq(series.id, seriesId), isNull(series.deletedAt)))
}
