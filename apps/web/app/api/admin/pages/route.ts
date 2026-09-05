import { adminMessages } from '@palscans/core/messages/admin'
import { getDb, pages } from '@palscans/db'
import { pageSlugTaken } from '@/components/admin/content/queries'
import { pageDocSchema } from '@/components/admin/content/schemas'
import { audit } from '@/components/admin/server/audit'
import { purgeSettings } from '@/components/admin/server/cache'
import { fail, ok, parseJson, withPermission } from '@/lib/auth'
import { bodyFrom } from './shared'

/** POST /api/admin/pages — a new static page (docs/13 "Legal pages"). */
export const POST = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, pageDocSchema)
  if (!parsed.ok) return parsed.response
  const doc = parsed.data
  const body = bodyFrom(doc.body)
  if (!body.ok) return body.response
  if (await pageSlugTaken(doc.slug, null))
    return fail(409, 'slug_taken', adminMessages.adminContent.pages.fields.slugCollision)
  const db = await getDb()
  const [row] = await db
    .insert(pages)
    .values({
      slug: doc.slug,
      title: doc.title,
      body: body.body,
      state: doc.state,
      updatedBy: user.id,
    })
    .returning({ id: pages.id, slug: pages.slug })
  if (!row) throw new Error('insert failed')
  await audit({
    actorId: user.id,
    action: 'page.create',
    targetType: 'page',
    targetId: row.id,
    after: { slug: doc.slug, title: doc.title, state: doc.state, version: 1 },
    request,
  })
  purgeSettings()
  return ok(row)
})
