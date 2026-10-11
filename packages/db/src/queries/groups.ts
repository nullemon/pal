import { slugify, uniqueSlug } from '@palscans/core/slug'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { type Db, getDb } from '../client.js'
import { chapterGroups, groups } from '../schema/index.js'

/**
 * Scanlation groups, the parts two processes need.
 *
 * Crediting is not only an admin screen's job: the manifest sync in `apps/worker` imports
 * chapters on a timer and the file it reads names the group, so the worker has to be able to
 * write a credit without a request going through `apps/web`. These live here rather than in
 * `apps/web/components/admin/server/groups.ts` so there is one implementation of each —
 * `find-or-create by slug` in particular, where a second copy would be a second answer to
 * "is 'Illeterate Scans' the group we already have?".
 *
 * The admin screen's own concerns — listing with chapter counts, renaming, soft delete —
 * stay in the web module; they have no second caller.
 */

/** Insert a group, resolving a slug collision before it reaches the unique index. */
export const insertGroup = async (
  input: { name: string; description?: string | null; links?: Record<string, string> },
  db?: Db,
): Promise<{ id: number; slug: string; name: string } | null> => {
  const database = db ?? (await getDb())
  const taken = await database.select({ slug: groups.slug }).from(groups)
  const slug = uniqueSlug(
    slugify(input.name, { fallback: 'group' }),
    taken.map((t) => t.slug.toLowerCase()),
  )
  const [row] = await database
    .insert(groups)
    .values({
      slug,
      name: input.name,
      description: input.description ?? null,
      links: input.links ?? {},
    })
    .returning({ id: groups.id, slug: groups.slug, name: groups.name })
  return row ?? null
}

/**
 * Set the groups credited on a set of chapters, replacing whatever was there.
 *
 * Replace rather than merge: the caller is a picker showing the current state, so what it
 * sends is the whole answer. Merging would make removing a wrong credit impossible from the
 * only screen that can set one.
 */
export const setChapterGroups = async (
  chapterIds: readonly number[],
  groupIds: readonly number[],
  db?: Db,
): Promise<number> => {
  if (chapterIds.length === 0) return 0
  const database = db ?? (await getDb())
  // Unknown or deleted ids are dropped rather than rejected: a stale picker should not fail
  // the whole assignment, and the response reports what was actually written.
  const live = groupIds.length
    ? await database
        .select({ id: groups.id })
        .from(groups)
        .where(and(inArray(groups.id, [...groupIds]), isNull(groups.deletedAt)))
    : []
  await database.transaction(async (tx) => {
    await tx.delete(chapterGroups).where(inArray(chapterGroups.chapterId, [...chapterIds]))
    if (live.length)
      await tx
        .insert(chapterGroups)
        .values(chapterIds.flatMap((c) => live.map((g) => ({ chapterId: c, groupId: g.id }))))
  })
  return live.length
}

/**
 * The group of this name, creating it if nobody has yet.
 *
 * For the importers, which are handed a group *name* rather than an id — the manifest says
 * "Illeterate Scans" and there is no reason to make an operator create that by hand before
 * importing, still less to make the unattended sync give up on a name it has not seen.
 * Matching is case-insensitive on the slug, so "Illeterate Scans" and "illeterate scans" are
 * one group rather than two.
 */
export const groupIdByName = async (name: string, db?: Db): Promise<number | null> => {
  const trimmed = name.trim()
  if (trimmed === '') return null
  const database = db ?? (await getDb())
  const wanted = slugify(trimmed, { fallback: 'group' })
  const [existing] = await database
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.slug, wanted), isNull(groups.deletedAt)))
    .limit(1)
  if (existing) return existing.id
  return (await insertGroup({ name: trimmed }, database))?.id ?? null
}

/** Credit one named group on these chapters, creating the group if it is new. */
export const creditChapterGroupByName = async (
  chapterIds: readonly number[],
  name: string,
  db?: Db,
): Promise<boolean> => {
  if (chapterIds.length === 0) return false
  const database = db ?? (await getDb())
  const groupId = await groupIdByName(name, database)
  if (!groupId) return false
  await setChapterGroups(chapterIds, [groupId], database)
  return true
}
