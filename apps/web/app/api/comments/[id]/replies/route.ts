import { db } from '@palscans/db'
import { notFound, ok } from '@/lib/comments/http'
import { listReplies, viewerFor } from '@/lib/comments/queries'
import { idParamSchema } from '@/lib/comments/schemas'
import { getAppUser } from '@/lib/comments/viewer'

/** GET /api/comments/:id/replies — every visible reply, oldest first ("Show N replies"). */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = idParamSchema.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const user = await getAppUser()
  const viewer = await viewerFor(db, user)
  const replies = await listReplies(db, id.data, viewer)
  return ok(
    { replies },
    { headers: { 'cache-control': viewer ? 'private, no-store' : 'public, s-maxage=60' } },
  )
}
