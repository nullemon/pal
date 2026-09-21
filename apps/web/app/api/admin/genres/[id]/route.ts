import { adminMessages } from '@palscans/core/messages/admin'
import { genres, getDb, restoreGenre, softDeleteGenre, updateGenre } from '@palscans/db'
import { and, eq, ne } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import {
  genreRestoreSchema,
  genreWriteSchema,
  isSlugConflict,
} from '@/components/admin/schemas-genres'
import { audit } from '@/components/admin/server/audit'
import { purgeCatalog } from '@/components/admin/server/cache'
import { idParam } from '@/components/admin/server/params'
import { fail, notFound, ok, parseJson, withPermission } from '@/lib/auth'

/**
 * `PATCH /api/admin/genres/:id` — rename, re-slug or reclassify (`series.update`).
 * `DELETE` — retire it (`series.delete`). `POST { action: 'restore' }` — bring it back.
 *
 * The slug is the part that needs care: `updateGenre` writes the old one to `slug_history`
 * so `/genres/<old>` keeps answering with a 301, and frees the new one from any redirect
 * that still claimed it. The route's own job is only to reject a slug another genre holds,
 * because the unique index would otherwise surface as a 500.
 */

const m = adminMessages.genreAdmin

export const PATCH = withPermission<{ id: string }>('series.update', async (request, ctx, user) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJson(request, genreWriteSchema)
  if (!parsed.ok) return parsed.response
  const slug = parsed.data.slug
  if (!slug) return fail(400, 'validation', m.slugInvalid)

  const db = await getDb()
  const [clash] = await db
    .select({ id: genres.id })
    .from(genres)
    .where(and(eq(genres.slug, slug), ne(genres.id, id.data)))
    .limit(1)
  if (clash) return fail(409, 'slug', m.slugTaken)

  let result: Awaited<ReturnType<typeof updateGenre>>
  try {
    result = await updateGenre(db, id.data, {
      name: parsed.data.name,
      slug,
      kind: parsed.data.kind,
    })
  } catch (error) {
    // The check above and this update are two statements; the unique index is the authority.
    if (isSlugConflict(error)) return fail(409, 'slug', m.slugTaken)
    throw error
  }
  if (!result) return notFound()
  purgeCatalog()
  if (result.redirectedFrom) revalidateTag('redirects', 'max')
  await audit({
    actorId: user.id,
    action: 'genre.update',
    targetType: 'genre',
    targetId: id.data,
    before: result.before,
    after: { ...result.after, redirectedFrom: result.redirectedFrom },
  })
  return ok({ ...result.after, redirectedFrom: result.redirectedFrom })
})

/**
 * Retire a genre. `series_genres` rows are kept on purpose — see `softDeleteGenre` — so this
 * is reversible, which is why it is a DELETE and not a merge. `series.delete`, matching the
 * permission that already gates removing something from the catalogue.
 */
export const DELETE = withPermission<{ id: string }>(
  'series.delete',
  async (_request, ctx, user) => {
    const id = idParam.safeParse((await ctx.params).id)
    if (!id.success) return notFound()
    const db = await getDb()
    const row = await softDeleteGenre(db, id.data)
    if (!row) return notFound()
    purgeCatalog()
    revalidateTag('redirects', 'max')
    await audit({
      actorId: user.id,
      action: 'genre.delete',
      targetType: 'genre',
      targetId: id.data,
      before: { ...row, deletedAt: null },
      after: row,
    })
    return ok(row)
  },
)

export const POST = withPermission<{ id: string }>('series.delete', async (request, ctx, user) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJson(request, genreRestoreSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const row = await restoreGenre(db, id.data)
  // A genre that lost a merge has `merged_into_id` set and cannot come back: its series are
  // on the winner now, and un-retiring the row would leave an empty tag with a live URL that
  // the redirect table still sends elsewhere.
  if (!row) return fail(409, 'not_restorable', m.retiredCannotRestore)
  purgeCatalog()
  revalidateTag('redirects', 'max')
  await audit({
    actorId: user.id,
    action: 'genre.restore',
    targetType: 'genre',
    targetId: id.data,
    after: row,
  })
  return ok(row)
})
