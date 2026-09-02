import { slugify } from '@palscans/core'
import { messages } from '@palscans/core/messages'
import {
  geoRestrictions,
  getDb,
  people,
  series,
  seriesGenres,
  seriesPeople,
  seriesTitles,
  slugHistory,
} from '@palscans/db'
import { eq } from 'drizzle-orm'
import { seriesDocSchema } from '@/components/admin/schemas'
import { audit, snapshot } from '@/components/admin/server/audit'
import { purgeCatalog } from '@/components/admin/server/cache'
import { idParam } from '@/components/admin/server/params'
import { richTextFromPlain, slugTaken } from '@/components/admin/server/series'
import { fail, notFound, ok, parseJson, withPermission } from '@/lib/auth'

const AUDITED = [
  'title',
  'slug',
  'type',
  'status',
  'state',
  'synopsis',
  'releasedYear',
  'serialization',
  'ageRating',
  'readingDirection',
  'isFeatured',
  'isPinned',
  'commentsEnabled',
  'linkedSeriesId',
  'seoTitle',
  'seoDescription',
  'focusKeyword',
  'noindex',
  'canonicalUrl',
  'ogImageKey',
] as const

/** PUT /api/admin/series/:id — the whole editor document (docs/04 series editor). */
export const PUT = withPermission<{ id: string }>('series.update', async (request, ctx, user) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJson(request, seriesDocSchema)
  if (!parsed.ok) return parsed.response
  const doc = parsed.data
  const db = await getDb()
  const [before] = await db.select().from(series).where(eq(series.id, id.data)).limit(1)
  if (!before) return notFound()
  if (doc.linkedSeriesId === id.data) return fail(400, 'validation', messages.errors.validation)
  if (doc.slug !== before.slug && (await slugTaken(doc.slug, id.data)))
    return fail(409, 'slug_taken', messages.admin.series.fields.slugCollision)

  // people: create on the fly by name (docs/04 "typeahead that creates on the fly")
  const personIds: Array<{ personId: number; credit: string }> = []
  for (const p of doc.people) {
    let personId = p.id
    if (!personId) {
      const slug = slugify(p.name)
      const [existing] = await db
        .select({ id: people.id })
        .from(people)
        .where(eq(people.slug, slug))
        .limit(1)
      if (existing) personId = existing.id
      else {
        const [created] = await db
          .insert(people)
          .values({ name: p.name, slug })
          .returning({ id: people.id })
        personId = created?.id ?? null
      }
    }
    if (personId && !personIds.some((x) => x.personId === personId && x.credit === p.credit))
      personIds.push({ personId, credit: p.credit })
  }

  await db.transaction(async (tx) => {
    await tx
      .update(series)
      .set({
        title: doc.title,
        slug: doc.slug,
        type: doc.type,
        status: doc.status,
        state: doc.state,
        synopsis: doc.synopsis,
        releasedYear: doc.releasedYear,
        serialization: doc.serialization,
        ageRating: doc.ageRating,
        readingDirection: doc.readingDirection,
        releaseSchedule: doc.releaseSchedule,
        contentWarnings: doc.contentWarnings,
        linkedSeriesId: doc.linkedSeriesId,
        isFeatured: doc.isFeatured,
        isPinned: doc.isPinned,
        commentsEnabled: doc.commentsEnabled,
        seoTitle: doc.seoTitle,
        seoDescription: doc.seoDescription,
        focusKeyword: doc.focusKeyword,
        seoText: richTextFromPlain(doc.seoText),
        noindex: doc.noindex,
        canonicalUrl: doc.canonicalUrl,
        ogImageKey: doc.ogImageKey,
        publishedAt:
          doc.state === 'published' && !before.publishedAt ? new Date() : before.publishedAt,
        updatedAt: new Date(),
      })
      .where(eq(series.id, id.data))
    if (doc.slug !== before.slug) {
      await tx
        .insert(slugHistory)
        .values({ entityType: 'series', oldSlug: before.slug, entityId: id.data })
        .onConflictDoNothing()
    }
    await tx.delete(seriesTitles).where(eq(seriesTitles.seriesId, id.data))
    if (doc.titles.length)
      await tx
        .insert(seriesTitles)
        .values(doc.titles.map((t) => ({ seriesId: id.data, title: t.title, lang: t.lang })))
        .onConflictDoNothing()
    await tx.delete(seriesPeople).where(eq(seriesPeople.seriesId, id.data))
    if (personIds.length)
      await tx.insert(seriesPeople).values(personIds.map((p) => ({ seriesId: id.data, ...p })))
    await tx.delete(seriesGenres).where(eq(seriesGenres.seriesId, id.data))
    if (doc.genreIds.length)
      await tx
        .insert(seriesGenres)
        .values(doc.genreIds.map((genreId) => ({ seriesId: id.data, genreId })))
        .onConflictDoNothing()
    await tx.delete(geoRestrictions).where(eq(geoRestrictions.seriesId, id.data))
    if (doc.geo.countries.length)
      await tx
        .insert(geoRestrictions)
        .values(
          doc.geo.countries.map((country) => ({ seriesId: id.data, country, mode: doc.geo.mode })),
        )
        .onConflictDoNothing()
  })
  const [after] = await db.select().from(series).where(eq(series.id, id.data)).limit(1)
  await audit({
    actorId: user.id,
    action: 'series.update',
    targetType: 'series',
    targetId: id.data,
    before: snapshot(before, AUDITED),
    after: snapshot(after, AUDITED),
    request,
  })
  purgeCatalog()
  return ok({ id: id.data, slug: doc.slug })
})

/** DELETE /api/admin/series/:id — soft delete (docs/16: nothing is hard-deleted). */
export const DELETE = withPermission<{ id: string }>(
  'series.delete',
  async (request, ctx, user) => {
    const id = idParam.safeParse((await ctx.params).id)
    if (!id.success) return notFound()
    const db = await getDb()
    const [before] = await db.select().from(series).where(eq(series.id, id.data)).limit(1)
    if (!before) return notFound()
    const restore = new URL(request.url).searchParams.get('restore') === '1'
    await db
      .update(series)
      .set({ deletedAt: restore ? null : new Date(), updatedAt: new Date() })
      .where(eq(series.id, id.data))
    await audit({
      actorId: user.id,
      action: restore ? 'series.restore' : 'series.delete',
      targetType: 'series',
      targetId: id.data,
      before: { deletedAt: before.deletedAt },
      after: { deletedAt: restore ? null : new Date().toISOString(), title: before.title },
      request,
    })
    purgeCatalog()
    return ok({ id: id.data, restored: restore })
  },
)
