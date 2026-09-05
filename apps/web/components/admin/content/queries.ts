import { announcements, getDb, pages, users } from '@palscans/db'
import { and, count, desc, eq, ilike, ne, or } from 'drizzle-orm'
import { PAGE_SIZE } from '@/components/admin/server/params'
import { docToMarkdown } from './markdown'
import type { AnnouncementDoc, ContentState, PageDoc } from './schemas'

/**
 * Reads behind the announcement and static-page admin screens (docs/04 Content group). The
 * editors work in the Markdown subset, so every loader hands back a `*Doc` ready to render
 * into the form, alongside the row for the metadata strip.
 */

export interface AnnouncementListParams {
  q?: string
  state?: string
  page: number
}

export const loadAnnouncementList = async (p: AnnouncementListParams) => {
  const db = await getDb()
  const where = and(
    p.q
      ? or(ilike(announcements.title, `%${p.q}%`), ilike(announcements.slug, `%${p.q}%`))
      : undefined,
    p.state ? eq(announcements.state, p.state as ContentState) : undefined,
  )
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: announcements.id,
        slug: announcements.slug,
        title: announcements.title,
        state: announcements.state,
        tags: announcements.tags,
        excerpt: announcements.excerpt,
        publishedAt: announcements.publishedAt,
        updatedAt: announcements.updatedAt,
        author: users.username,
      })
      .from(announcements)
      .leftJoin(users, eq(users.id, announcements.authorId))
      .where(where)
      .orderBy(desc(announcements.publishedAt), desc(announcements.id))
      .limit(PAGE_SIZE)
      .offset((p.page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(announcements).where(where),
  ])
  const n = total?.n ?? 0
  return { rows, total: n, pages: Math.max(1, Math.ceil(n / PAGE_SIZE)) }
}

export interface AnnouncementEditorData {
  id: number
  doc: AnnouncementDoc
  updatedAt: Date
  author: string | null
}

export const loadAnnouncementEditor = async (
  id: number,
): Promise<AnnouncementEditorData | null> => {
  const db = await getDb()
  const [row] = await db
    .select({
      id: announcements.id,
      slug: announcements.slug,
      title: announcements.title,
      body: announcements.body,
      excerpt: announcements.excerpt,
      coverKey: announcements.coverKey,
      tags: announcements.tags,
      state: announcements.state,
      publishedAt: announcements.publishedAt,
      updatedAt: announcements.updatedAt,
      author: users.username,
    })
    .from(announcements)
    .leftJoin(users, eq(users.id, announcements.authorId))
    .where(eq(announcements.id, id))
    .limit(1)
  if (!row) return null
  return {
    id: row.id,
    updatedAt: row.updatedAt,
    author: row.author,
    doc: {
      title: row.title,
      slug: row.slug,
      body: docToMarkdown(row.body),
      excerpt: row.excerpt,
      coverKey: row.coverKey,
      tags: [...row.tags],
      state: row.state,
      publishedAt: row.publishedAt?.toISOString() ?? null,
    },
  }
}

export const loadPageList = async () => {
  const db = await getDb()
  return db
    .select({
      id: pages.id,
      slug: pages.slug,
      title: pages.title,
      state: pages.state,
      version: pages.version,
      updatedAt: pages.updatedAt,
      updatedBy: users.username,
    })
    .from(pages)
    .leftJoin(users, eq(users.id, pages.updatedBy))
    .orderBy(pages.slug)
}

export interface PageEditorData {
  id: number
  doc: PageDoc
  version: number
  updatedAt: Date
  updatedBy: string | null
}

export const loadPageEditor = async (id: number): Promise<PageEditorData | null> => {
  const db = await getDb()
  const [row] = await db
    .select({
      id: pages.id,
      slug: pages.slug,
      title: pages.title,
      body: pages.body,
      state: pages.state,
      version: pages.version,
      updatedAt: pages.updatedAt,
      updatedBy: users.username,
    })
    .from(pages)
    .leftJoin(users, eq(users.id, pages.updatedBy))
    .where(eq(pages.id, id))
    .limit(1)
  if (!row) return null
  return {
    id: row.id,
    version: Number(row.version),
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    doc: {
      title: row.title,
      slug: row.slug,
      body: docToMarkdown(row.body),
      state: row.state,
    },
  }
}

/** Both slug columns are `citext`, so an equality check is already case-insensitive. */
export const announcementSlugTaken = async (
  slug: string,
  exceptId: number | null,
): Promise<boolean> => {
  const db = await getDb()
  const [row] = await db
    .select({ id: announcements.id })
    .from(announcements)
    .where(
      and(
        eq(announcements.slug, slug),
        exceptId === null ? undefined : ne(announcements.id, exceptId),
      ),
    )
    .limit(1)
  return !!row
}

export const pageSlugTaken = async (slug: string, exceptId: number | null): Promise<boolean> => {
  const db = await getDb()
  const [row] = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.slug, slug), exceptId === null ? undefined : ne(pages.id, exceptId)))
    .limit(1)
  return !!row
}
