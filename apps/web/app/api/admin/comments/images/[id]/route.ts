import { communityImages, getDb } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { imageActionSchema } from '@/components/admin/schemas-moderation'
import { audit } from '@/components/admin/server/audit'
import { idParam } from '@/components/admin/server/params'
import { notFound, ok, parseJson, withPermission } from '@/lib/auth'

/** POST /api/admin/comments/images/:id { action: approve | remove | collection, tags? } */
export const POST = withPermission<{ id: string }>(
  'comment.moderate',
  async (request, ctx, user) => {
    const id = idParam.safeParse((await ctx.params).id)
    if (!id.success) return notFound()
    const parsed = await parseJson(request, imageActionSchema)
    if (!parsed.ok) return parsed.response
    const db = await getDb()
    const [before] = await db
      .select()
      .from(communityImages)
      .where(eq(communityImages.id, id.data))
      .limit(1)
    if (!before) return notFound()
    const set =
      parsed.data.action === 'remove'
        ? { status: 'removed' }
        : parsed.data.action === 'collection'
          ? {
              status: 'approved',
              isCollection: true,
              ...(parsed.data.tags ? { tags: parsed.data.tags } : {}),
            }
          : { status: 'approved', ...(parsed.data.tags ? { tags: parsed.data.tags } : {}) }
    const [after] = await db
      .update(communityImages)
      .set(set)
      .where(eq(communityImages.id, id.data))
      .returning()
    await audit({
      actorId: user.id,
      action: `community_image.${parsed.data.action}`,
      targetType: 'community_image',
      targetId: id.data,
      before: { status: before.status, isCollection: before.isCollection },
      after: set,
      request,
    })
    return ok(after)
  },
)
