import { slugify } from '@palscans/core'
import { adminMessages } from '@palscans/core/messages/admin'
import { createGenre, genres, getDb, reorderGenres } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import {
  genreReorderSchema,
  genreWriteSchema,
  isSlugConflict,
} from '@/components/admin/schemas-genres'
import { audit } from '@/components/admin/server/audit'
import { purgeCatalog } from '@/components/admin/server/cache'
import { fail, ok, parseJson, withPermission } from '@/lib/auth'

/**
 * `POST /api/admin/genres` — add a genre. `PATCH` — write the listing order of one kind.
 *
 * Permission: **`series.update`**, the same gate as editing the series that carry these
 * tags. Retiring and merging are a level up (`series.delete`) and live in the sibling routes.
 */

const m = adminMessages.genreAdmin

/** The slug is resolved server-side: an empty one is generated, and either is checked here. */
const resolveSlug = async (name: string, wanted: string | undefined, exceptId?: number) => {
  const slug = wanted && wanted.length > 0 ? wanted : slugify(name)
  if (!slug) return { error: m.slugInvalid }
  const db = await getDb()
  const [clash] = await db
    .select({ id: genres.id })
    .from(genres)
    .where(eq(genres.slug, slug))
    .limit(1)
  if (clash && clash.id !== exceptId) return { error: m.slugTaken }
  return { slug }
}

export const POST = withPermission('series.update', async (request, _ctx, user) => {
  const parsed = await parseJson(request, genreWriteSchema)
  if (!parsed.ok) return parsed.response
  const resolved = await resolveSlug(parsed.data.name, parsed.data.slug)
  if ('error' in resolved) return fail(409, 'slug', resolved.error)

  const db = await getDb()
  let row: Awaited<ReturnType<typeof createGenre>>
  try {
    row = await createGenre(db, {
      name: parsed.data.name,
      slug: resolved.slug,
      kind: parsed.data.kind,
    })
  } catch (error) {
    // The check above and this insert are two statements; the unique index is the authority.
    if (isSlugConflict(error)) return fail(409, 'slug', m.slugTaken)
    throw error
  }
  purgeCatalog()
  await audit({
    actorId: user.id,
    action: 'genre.create',
    targetType: 'genre',
    targetId: row.id,
    after: row,
    request,
  })
  return ok(row)
})

/** `PATCH { kind, ids }` — the ids of one kind in the order readers should see them. */
export const PATCH = withPermission('series.update', async (request, _ctx, user) => {
  const parsed = await parseJson(request, genreReorderSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const moved = await reorderGenres(db, parsed.data.kind, parsed.data.ids)
  purgeCatalog()
  // /genres and the browse filters are ISR'd on the `catalog` tag; the order is part of it.
  revalidateTag('catalog', 'max')
  await audit({
    actorId: user.id,
    action: 'genre.reorder',
    targetType: 'genre',
    after: { kind: parsed.data.kind, order: parsed.data.ids, moved },
    request,
  })
  return ok({ kind: parsed.data.kind, moved })
})
