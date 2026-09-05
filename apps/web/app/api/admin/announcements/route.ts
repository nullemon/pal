import { messages } from '@palscans/core/messages'
import { announcements, getDb } from '@palscans/db'
import { announcementSlugTaken } from '@/components/admin/content/queries'
import { announcementDocSchema } from '@/components/admin/content/schemas'
import { audit } from '@/components/admin/server/audit'
import { purgeCatalog } from '@/components/admin/server/cache'
import { fail, ok, parseJson, withPermission } from '@/lib/auth'
import { AUDITED, bodyFrom, publishAt } from './shared'

/** POST /api/admin/announcements — create a post (docs/04 Content · Announcements). */
export const POST = withPermission('announcement.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, announcementDocSchema)
  if (!parsed.ok) return parsed.response
  const doc = parsed.data
  const body = bodyFrom(doc.body)
  if (!body.ok) return body.response
  if (await announcementSlugTaken(doc.slug, null))
    return fail(409, 'slug_taken', messages.adminContent.announcements.fields.slugCollision)
  const db = await getDb()
  const publishedAt = publishAt(doc, null)
  const [row] = await db
    .insert(announcements)
    .values({
      slug: doc.slug,
      title: doc.title,
      body: body.body,
      excerpt: doc.excerpt,
      coverKey: doc.coverKey,
      tags: doc.tags,
      state: doc.state,
      authorId: user.id,
      publishedAt,
    })
    .returning({ id: announcements.id, slug: announcements.slug })
  if (!row) throw new Error('insert failed')
  await audit({
    actorId: user.id,
    action: 'announcement.create',
    targetType: 'announcement',
    targetId: row.id,
    // The stored date, not the (often empty) one on the wire.
    after: { ...Object.fromEntries(AUDITED.map((k) => [k, doc[k]])), publishedAt },
    request,
  })
  purgeCatalog()
  return ok(row)
})
