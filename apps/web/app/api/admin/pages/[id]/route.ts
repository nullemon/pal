import { adminMessages } from '@palscans/core/messages/admin'
import { getDb, pages } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { pageSlugTaken } from '@/components/admin/content/queries'
import { pageDocSchema } from '@/components/admin/content/schemas'
import { audit, snapshot } from '@/components/admin/server/audit'
import { purgeSettings } from '@/components/admin/server/cache'
import { idParam } from '@/components/admin/server/params'
import { fail, notFound, ok, parseJson, withPermission } from '@/lib/auth'
import { AUDITED, bodyFrom } from '../shared'

/**
 * PUT /api/admin/pages/:id — edit a static page. `version` counts published revisions: the
 * public page prints "Last updated … · version N", so a change to the text bumps it while a
 * state-only change does not.
 */
export const PUT = withPermission<{ id: string }>('settings.write', async (request, ctx, user) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJson(request, pageDocSchema)
  if (!parsed.ok) return parsed.response
  const doc = parsed.data
  const body = bodyFrom(doc.body)
  if (!body.ok) return body.response
  const db = await getDb()
  const [before] = await db.select().from(pages).where(eq(pages.id, id.data)).limit(1)
  if (!before) return notFound()
  if (doc.slug !== before.slug && (await pageSlugTaken(doc.slug, id.data)))
    return fail(409, 'slug_taken', adminMessages.adminContent.pages.fields.slugCollision)
  const changed =
    JSON.stringify(before.body) !== JSON.stringify(body.body) || before.title !== doc.title
  await db
    .update(pages)
    .set({
      slug: doc.slug,
      title: doc.title,
      body: body.body,
      state: doc.state,
      version: changed ? Number(before.version) + 1 : before.version,
      updatedBy: user.id,
      updatedAt: new Date(),
    })
    .where(eq(pages.id, id.data))
  const [after] = await db.select().from(pages).where(eq(pages.id, id.data)).limit(1)
  await audit({
    actorId: user.id,
    action: 'page.update',
    targetType: 'page',
    targetId: id.data,
    before: snapshot(before, AUDITED),
    after: snapshot(after, AUDITED),
    request,
  })
  purgeSettings()
  return ok({ id: id.data, slug: doc.slug, version: Number(after?.version ?? before.version) })
})
