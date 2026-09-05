import { fmt, messages } from '@palscans/core/messages'
import { db, followState, series, setFollowMode, unfollowSeries } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { notFound, ok, parseJsonOptional, requireUser } from '@/lib/comments/http'
import { idParamSchema } from '@/lib/comments/schemas'
import { DEFAULT_FOLLOW_MODE, followModeSchema } from '@/lib/notifications/schema'

/**
 * Following a series (docs/17 §D) — the subscription, which is deliberately *not* the
 * bookmark on `/api/series/:id/bookmark`. That one is a shelf and keeps working exactly as
 * it did; this one decides whether and how a new chapter reaches the reader.
 *
 * `PUT` writes the per-series mode (and is how a follow is created), `DELETE` unfollows.
 * Both go through `@palscans/db`, where "a bookmark with no row is an implicit follow" is
 * written down once — including the reason `DELETE` may have to *write* `off` rather than
 * delete: with a bookmark behind it, deleting the row would re-subscribe the reader.
 */
type Params = { seriesId: string }

const bodySchema = z.object({ mode: followModeSchema.default(DEFAULT_FOLLOW_MODE) })

const liveSeries = async (id: number) => {
  const [row] = await db
    .select({ id: series.id, title: series.title })
    .from(series)
    .where(and(eq(series.id, id), eq(series.state, 'published'), isNull(series.deletedAt)))
    .limit(1)
  return row ?? null
}

/** PUT /api/follows/:seriesId {mode?} — follow, or change how loud the series may be. */
export const PUT = requireUser<Params>(async (request, ctx, user) => {
  const id = idParamSchema.safeParse((await ctx.params).seriesId)
  if (!id.success) return notFound()
  const parsed = await parseJsonOptional(request, bodySchema, { mode: DEFAULT_FOLLOW_MODE })
  if (!parsed.ok) return parsed.response
  const row = await liveSeries(id.data)
  if (!row) return notFound()
  const before = await followState(db, user.id, id.data)
  if (!(await setFollowMode(db, user.id, id.data, parsed.data.mode))) return notFound()
  const following = parsed.data.mode !== 'off'
  return ok({
    following,
    mode: parsed.data.mode,
    source: 'follow' as const,
    message:
      before?.source === 'follow' && before.mode !== parsed.data.mode
        ? messages.follows.savedToast
        : following
          ? fmt(messages.follows.followedToast, { title: row.title })
          : fmt(messages.follows.mutedToast, { title: row.title }),
  })
})

/** DELETE /api/follows/:seriesId — stop being told about this series. */
export const DELETE = requireUser<Params>(async (_request, ctx, user) => {
  const id = idParamSchema.safeParse((await ctx.params).seriesId)
  if (!id.success) return notFound()
  const row = await liveSeries(id.data)
  if (!row) return notFound()
  const outcome = await unfollowSeries(db, user.id, id.data)
  return ok({
    following: false,
    mode: outcome === 'muted' ? ('off' as const) : null,
    source: outcome === 'muted' ? ('follow' as const) : null,
    message:
      outcome === 'muted'
        ? fmt(messages.follows.mutedToast, { title: row.title })
        : fmt(messages.follows.unfollowedToast, { title: row.title }),
  })
})
