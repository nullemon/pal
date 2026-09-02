import {
  bookmarks,
  chapterReads,
  chapters,
  comments,
  getDb,
  ratings,
  series,
  users,
} from '@palscans/db'
import { desc, eq } from 'drizzle-orm'
import { requireUser } from '@/lib/auth'

/** GET /api/me/export — docs/13 right of access: profile, bookmarks, history, ratings, comments as JSON. */
export const GET = requireUser(async (_request, _ctx, user) => {
  const db = await getDb()
  const [profile] = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      displayName: users.displayName,
      bio: users.bio,
      role: users.role,
      emailVerifiedAt: users.emailVerifiedAt,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)
  const [marks, reads, rates, posts] = await Promise.all([
    db
      .select({
        series: series.title,
        slug: series.slug,
        status: bookmarks.status,
        isPublic: bookmarks.isPublic,
        createdAt: bookmarks.createdAt,
      })
      .from(bookmarks)
      .innerJoin(series, eq(series.id, bookmarks.seriesId))
      .where(eq(bookmarks.userId, user.id)),
    db
      .select({
        series: series.title,
        slug: series.slug,
        chapter: chapters.number,
        readAt: chapterReads.readAt,
      })
      .from(chapterReads)
      .innerJoin(chapters, eq(chapters.id, chapterReads.chapterId))
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .where(eq(chapterReads.userId, user.id))
      .orderBy(desc(chapterReads.readAt)),
    db
      .select({
        series: series.title,
        slug: series.slug,
        score: ratings.score,
        updatedAt: ratings.updatedAt,
      })
      .from(ratings)
      .innerJoin(series, eq(series.id, ratings.seriesId))
      .where(eq(ratings.userId, user.id)),
    db
      .select({
        id: comments.id,
        seriesId: comments.seriesId,
        chapterId: comments.chapterId,
        body: comments.body,
        isSpoiler: comments.isSpoiler,
        createdAt: comments.createdAt,
        deletedAt: comments.deletedAt,
      })
      .from(comments)
      .where(eq(comments.userId, user.id))
      .orderBy(desc(comments.createdAt)),
  ])
  const payload = {
    exportedAt: new Date().toISOString(),
    profile,
    bookmarks: marks,
    history: reads,
    ratings: rates,
    comments: posts,
  }
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="palscans-export-${user.id}.json"`,
      'cache-control': 'private, no-store',
    },
  })
})
