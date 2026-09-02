import { getDb, wordFilters } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { audit } from '@/components/admin/server/audit'
import { idParam } from '@/components/admin/server/params'
import { notFound, ok, withPermission } from '@/lib/auth'

export const DELETE = withPermission<{ id: string }>(
  'settings.write',
  async (request, ctx, user) => {
    const id = idParam.safeParse((await ctx.params).id)
    if (!id.success) return notFound()
    const db = await getDb()
    const [row] = await db.delete(wordFilters).where(eq(wordFilters.id, id.data)).returning()
    if (!row) return notFound()
    await audit({
      actorId: user.id,
      action: 'settings.word_filter.delete',
      targetType: 'word_filter',
      targetId: id.data,
      before: row,
      request,
    })
    return ok({ id: id.data })
  },
)
