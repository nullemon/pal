import 'server-only'
import { slugify, uniqueSlug } from '@palscans/core/slug'
import { chapterGroups, type Db, getDb, groups } from '@palscans/db'
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm'

/**
 * Scanlation groups (docs/13).
 *
 * The table and the `chapter_groups` join have existed since the schema was written and
 * nothing ever wrote to either, so the feature was fully modelled and completely unreachable.
 * This is the missing half: listing, naming and crediting.
 *
 * Crediting the group is not decoration on a scanlation site — it is the convention the work
 * is shared under, and some groups make it a condition. A chapter that cannot name its group
 * is a chapter that cannot be hosted politely.
 */

export interface GroupRow {
  id: number
  slug: string
  name: string
  description: string | null
  links: Record<string, string>
  chapterCount: number
}

export const listGroups = async (db?: Db): Promise<GroupRow[]> => {
  const database = db ?? (await getDb())
  const rows = await database
    .select({
      id: groups.id,
      slug: groups.slug,
      name: groups.name,
      description: groups.description,
      links: groups.links,
      chapterCount: count(chapterGroups.chapterId),
    })
    .from(groups)
    .leftJoin(chapterGroups, eq(chapterGroups.groupId, groups.id))
    .where(isNull(groups.deletedAt))
    .groupBy(groups.id)
    .orderBy(desc(count(chapterGroups.chapterId)), groups.name)
    .limit(500)
  return rows.map((r) => ({ ...r, links: r.links ?? {} }))
}

/** Slugs are unique and the column is citext, so collisions are resolved before insert. */
export const createGroup = async (
  input: { name: string; description?: string | null; links?: Record<string, string> },
  db?: Db,
): Promise<GroupRow | null> => {
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
  if (!row) return null
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: input.description ?? null,
    links: input.links ?? {},
    chapterCount: 0,
  }
}

/**
 * Rename or re-describe. The slug is deliberately not regenerated: it is in the URL of any
 * page that lists the group's work, and a rename is usually a correction to spelling rather
 * than a new identity.
 */
export const updateGroup = async (
  id: number,
  input: { name?: string; description?: string | null; links?: Record<string, string> },
  db?: Db,
): Promise<boolean> => {
  const database = db ?? (await getDb())
  const result = await database
    .update(groups)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.links !== undefined ? { links: input.links } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(groups.id, id), isNull(groups.deletedAt)))
    .returning({ id: groups.id })
  return result.length > 0
}

/**
 * Soft delete, like every other catalogue row.
 *
 * The `chapter_groups` rows are left alone. They cascade on a *hard* delete, and keeping them
 * means restoring the group restores its credits — which matters, because deleting a group
 * by mistake would otherwise silently strip the attribution from every chapter it ever
 * scanlated, with no record of which ones they were.
 */
export const deleteGroup = async (id: number, db?: Db): Promise<boolean> => {
  const database = db ?? (await getDb())
  const result = await database
    .update(groups)
    .set({ deletedAt: new Date() })
    .where(and(eq(groups.id, id), isNull(groups.deletedAt)))
    .returning({ id: groups.id })
  return result.length > 0
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

/** The groups credited on each of these chapters, for the picker and the public credit. */
export const groupsForChapters = async (
  chapterIds: readonly number[],
  db?: Db,
): Promise<Map<number, Array<{ id: number; slug: string; name: string }>>> => {
  const out = new Map<number, Array<{ id: number; slug: string; name: string }>>()
  if (chapterIds.length === 0) return out
  const database = db ?? (await getDb())
  const rows = await database
    .select({
      chapterId: chapterGroups.chapterId,
      id: groups.id,
      slug: groups.slug,
      name: groups.name,
    })
    .from(chapterGroups)
    .innerJoin(groups, eq(groups.id, chapterGroups.groupId))
    .where(and(inArray(chapterGroups.chapterId, [...chapterIds]), isNull(groups.deletedAt)))
    .orderBy(groups.name)
  for (const r of rows) {
    const list = out.get(r.chapterId) ?? []
    list.push({ id: r.id, slug: r.slug, name: r.name })
    out.set(r.chapterId, list)
  }
  return out
}

/** Guard for the links map: a handful of labelled URLs, http(s) only. */
export const cleanLinks = (input: unknown): Record<string, string> => {
  if (!input || typeof input !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [label, value] of Object.entries(input as Record<string, unknown>).slice(0, 10)) {
    if (typeof value !== 'string') continue
    try {
      const url = new URL(value)
      // A group's links are rendered as anchors on a public page, so anything that is not
      // plainly http(s) — `javascript:` above all — never reaches storage.
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
      out[label.slice(0, 40)] = url.toString().slice(0, 300)
    } catch {
      /* not a URL */
    }
  }
  return out
}
