import 'server-only'
import {
  chapterGroups,
  chapters,
  type Db,
  getDb,
  groups,
  insertGroup,
  setChapterGroups,
} from '@palscans/db'
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm'

/**
 * Crediting itself lives in `@palscans/db` and is re-exported here.
 *
 * The manifest sync runs in `apps/worker` and credits the group its file names, so the
 * find-or-create cannot live behind `server-only` code in this app. Re-exporting keeps every
 * call site in the admin screens pointing at one import.
 */
export { groupIdByName, setChapterGroups } from '@palscans/db'

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
  const row = await insertGroup(input, db ?? (await getDb()))
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

/**
 * Credit a group on every chapter of a series.
 *
 * The common case by a long way: one group scanlated the whole title, and setting it chapter
 * by chapter across forty of them is the kind of chore that means nobody does it — so the
 * credit the work was shared under never appears.
 *
 * Language-aware, because a translated run is usually a different group's work. Passing a
 * language credits only that run; omitting it credits the lot.
 */
export const setSeriesGroups = async (
  seriesId: number,
  groupIds: readonly number[],
  opts: { language?: string | null; db?: Db } = {},
): Promise<{ chapters: number; groups: number }> => {
  const database = opts.db ?? (await getDb())
  const rows = await database
    .select({ id: chapters.id })
    .from(chapters)
    .where(
      and(
        eq(chapters.seriesId, seriesId),
        isNull(chapters.deletedAt),
        ...(opts.language ? [eq(chapters.language, opts.language)] : []),
      ),
    )
  const ids = rows.map((r) => r.id)
  if (ids.length === 0) return { chapters: 0, groups: 0 }
  const written = await setChapterGroups(ids, groupIds, database)
  return { chapters: ids.length, groups: written }
}
