import { messages } from '@palscans/core/messages'
import { announcements, getDb } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { announcementSlugTaken } from '@/components/admin/content/queries'
import { announcementDocSchema } from '@/components/admin/content/schemas'
import { audit, snapshot } from '@/components/admin/server/audit'
import { purgeCatalog } from '@/components/admin/server/cache'
import { idParam } from '@/components/admin/server/params'
import { fail, notFound, ok, parseJson, withPermission } from '@/lib/auth'
import { AUDITED, bodyFrom, publishAt } from '../shared'

/** PUT /api/admin/announcements/:id — the whole post, body included. */
export const PUT = withPermission<{ id: string }>(
  'announcement.write',
  async (request, ctx, user) => {
    const id = idParam.safeParse((await ctx.params).id)
    if (!id.success) return notFound()
    const parsed = await parseJson(request, announcementDocSchema)
    if (!parsed.ok) return parsed.response
    const doc = parsed.data
    const body = bodyFrom(doc.body)
    if (!body.ok) return body.response
    const db = await getDb()
    const [before] = await db
      .select()
      .from(announcements)
      .where(eq(announcements.id, id.data))
      .limit(1)
    if (!before) return notFound()
    if (doc.slug !== before.slug && (await announcementSlugTaken(doc.slug, id.data)))
      return fail(409, 'slug_taken', messages.adminContent.announcements.fields.slugCollision)
    await db
      .update(announcements)
      .set({
        slug: doc.slug,
        title: doc.title,
        body: body.body,
        excerpt: doc.excerpt,
        coverKey: doc.coverKey,
        tags: doc.tags,
        state: doc.state,
        publishedAt: publishAt(doc, before.publishedAt),
        updatedAt: new Date(),
      })
      .where(eq(announcements.id, id.data))
    const [after] = await db
      .select()
      .from(announcements)
      .where(eq(announcements.id, id.data))
      .limit(1)
    await audit({
      actorId: user.id,
      action: 'announcement.update',
      targetType: 'announcement',
      targetId: id.data,
      before: snapshot(before, AUDITED),
      after: snapshot(after, AUDITED),
      request,
    })
    purgeCatalog()
    return ok({ id: id.data, slug: doc.slug })
  },
)

/**
 * DELETE /api/admin/announcements/:id — the row has no `deleted_at`, so removal is the
 * `removed` publication state (docs/16: nothing is hard-deleted). `?restore=1` puts it back
 * as a draft.
 */
export const DELETE = withPermission<{ id: string }>(
  'announcement.write',
  async (request, ctx, user) => {
    const id = idParam.safeParse((await ctx.params).id)
    if (!id.success) return notFound()
    const db = await getDb()
    const [before] = await db
      .select({ id: announcements.id, title: announcements.title, state: announcements.state })
      .from(announcements)
      .where(eq(announcements.id, id.data))
      .limit(1)
    if (!before) return notFound()
    const restore = new URL(request.url).searchParams.get('restore') === '1'
    const state = restore ? 'draft' : 'removed'
    await db
      .update(announcements)
      .set({ state, updatedAt: new Date() })
      .where(eq(announcements.id, id.data))
    await audit({
      actorId: user.id,
      action: restore ? 'announcement.restore' : 'announcement.delete',
      targetType: 'announcement',
      targetId: id.data,
      before: { state: before.state },
      after: { state, title: before.title },
      request,
    })
    purgeCatalog()
    return ok({ id: id.data, state, restored: restore })
  },
)
