import { can } from '@palscans/core'
import { chapters, getDb, series, users } from '@palscans/db'
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { ok, parseQuery, withPermission } from '@/lib/auth'

/**
 * What the ⌘K palette searches.
 *
 * Every section is gated on the permission its destination needs, and a caller without it
 * gets no rows rather than rows that 403 on click — the palette is a shortcut to screens,
 * so offering one an uploader cannot open is just a slower way to reach a refusal.
 *
 * `admin.access` is the gate on the route itself because a palette that returns nothing is
 * still a palette; the per-section checks decide what is in it.
 */
const query = z.object({ q: z.string().min(2).max(80) })

const LIMIT = 6

export const GET = withPermission('admin.access', async (request, _ctx, user) => {
  const parsed = parseQuery(request, query)
  if (!parsed.ok) return parsed.response
  const q = parsed.data.q.trim()
  const like = `%${q}%`
  const db = await getDb()

  const wantSeries = can(user, 'series.read')
  const wantChapters = can(user, 'chapter.read')
  const wantUsers = can(user, 'user.read')

  const [seriesRows, chapterRows, userRows] = await Promise.all([
    wantSeries
      ? db
          .select({ id: series.id, title: series.title, slug: series.slug })
          .from(series)
          .where(and(isNull(series.deletedAt), sql`${series.title} ILIKE ${like}`))
          .orderBy(desc(series.viewCount))
          .limit(LIMIT)
      : Promise.resolve([]),
    wantChapters
      ? db
          .select({
            id: chapters.id,
            number: chapters.number,
            title: chapters.title,
            seriesTitle: series.title,
          })
          .from(chapters)
          .innerJoin(series, eq(series.id, chapters.seriesId))
          .where(
            and(
              isNull(chapters.deletedAt),
              or(sql`${chapters.title} ILIKE ${like}`, sql`${series.title} ILIKE ${like}`),
            ),
          )
          .orderBy(desc(chapters.publishedAt))
          .limit(LIMIT)
      : Promise.resolve([]),
    wantUsers
      ? db
          .select({ id: users.id, username: users.username, email: users.email })
          .from(users)
          .where(
            and(
              isNull(users.deletedAt),
              or(sql`${users.username} ILIKE ${like}`, sql`${users.email} ILIKE ${like}`),
            ),
          )
          .limit(LIMIT)
      : Promise.resolve([]),
  ])

  return ok({
    series: seriesRows.map((r) => ({
      id: r.id,
      label: r.title,
      href: `/admin/series/${r.id}`,
    })),
    chapters: chapterRows.map((r) => ({
      id: r.id,
      label: `${r.seriesTitle} · ${r.number}${r.title ? ` — ${r.title}` : ''}`,
      href: `/admin/chapters/${r.id}/pages`,
    })),
    users: userRows.map((r) => ({
      id: r.id,
      label: r.username ?? r.email ?? String(r.id),
      href: `/admin/users/${r.id}`,
    })),
  })
})
