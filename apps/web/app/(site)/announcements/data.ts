import { announcements, getDb, users } from '@palscans/db'
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'

/** Published announcements (docs/12 §1 `/announcements/<slug>`), newest first. */
const columns = {
  id: announcements.id,
  slug: announcements.slug,
  title: announcements.title,
  body: announcements.body,
  excerpt: announcements.excerpt,
  coverKey: announcements.coverKey,
  tags: announcements.tags,
  publishedAt: announcements.publishedAt,
  updatedAt: announcements.updatedAt,
  author: users.username,
  authorDisplay: users.displayName,
} as const

const visible = () =>
  and(
    eq(announcements.state, 'published'),
    or(isNull(announcements.publishedAt), sql`${announcements.publishedAt} <= now()`),
  )

/** Dates as ISO strings: `unstable_cache` serialises its return value. */
const serialise = <T extends { publishedAt: Date | null; updatedAt: Date }>(row: T) => ({
  ...row,
  publishedAt: row.publishedAt?.toISOString() ?? null,
  updatedAt: row.updatedAt.toISOString(),
})

export const listAnnouncements = unstable_cache(
  async (limit = 50) => {
    const db = await getDb()
    const rows = await db
      .select(columns)
      .from(announcements)
      .leftJoin(users, eq(users.id, announcements.authorId))
      .where(visible())
      .orderBy(desc(announcements.publishedAt), desc(announcements.id))
      .limit(limit)
    return rows.map(serialise)
  },
  ['announcements', 'list'],
  { revalidate: 300, tags: ['catalog', 'announcements'] },
)

export const announcementBySlug = unstable_cache(
  async (slug: string) => {
    const db = await getDb()
    const [row] = await db
      .select(columns)
      .from(announcements)
      .leftJoin(users, eq(users.id, announcements.authorId))
      .where(and(eq(announcements.slug, slug), visible()))
      .limit(1)
    return row ? serialise(row) : null
  },
  ['announcements', 'one'],
  { revalidate: 300, tags: ['catalog', 'announcements'] },
)

export type AnnouncementRow = Awaited<ReturnType<typeof listAnnouncements>>[number]
