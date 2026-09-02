import { chapters, getDb } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { chapterPatchSchema } from '@/components/admin/schemas'
import { audit, snapshot } from '@/components/admin/server/audit'
import { purgeCatalog } from '@/components/admin/server/cache'
import { publishChapters, scheduleChapters } from '@/components/admin/server/chapters'
import { idParam } from '@/components/admin/server/params'
import { fail, notFound, ok, parseJson, withPermission } from '@/lib/auth'

const KEYS = [
  'number',
  'title',
  'volume',
  'state',
  'isPremium',
  'earlyAccessUntil',
  'publishedAt',
] as const

/** PATCH /api/admin/chapters/:id — metadata, flags, and single-chapter publish/schedule. */
export const PATCH = withPermission<{ id: string }>(
  'chapter.update',
  async (request, ctx, user) => {
    const id = idParam.safeParse((await ctx.params).id)
    if (!id.success) return notFound()
    const parsed = await parseJson(request, chapterPatchSchema)
    if (!parsed.ok) return parsed.response
    const body = parsed.data
    const db = await getDb()
    const [before] = await db.select().from(chapters).where(eq(chapters.id, id.data)).limit(1)
    if (!before) return notFound()
    const { can } = await import('@palscans/core')
    if (
      body.state &&
      (body.state === 'published' || body.state === 'scheduled') &&
      !can(user, 'chapter.publish')
    )
      return fail(403, 'forbidden')
    const now = new Date()
    await db
      .update(chapters)
      .set({
        ...(body.number !== undefined ? { number: body.number } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.volume !== undefined ? { volume: body.volume } : {}),
        ...(body.isPremium !== undefined ? { isPremium: body.isPremium } : {}),
        ...(body.earlyAccessUntil !== undefined
          ? { earlyAccessUntil: body.earlyAccessUntil ? new Date(body.earlyAccessUntil) : null }
          : {}),
        ...(body.state === 'draft' || body.state === 'ready' ? { state: body.state } : {}),
        updatedAt: now,
      })
      .where(eq(chapters.id, id.data))
    if (body.state === 'published') await publishChapters([id.data], now)
    if (body.state === 'scheduled' && body.publishedAt)
      await scheduleChapters([id.data], new Date(body.publishedAt), now)
    const [after] = await db.select().from(chapters).where(eq(chapters.id, id.data)).limit(1)
    await audit({
      actorId: user.id,
      action: 'chapter.update',
      targetType: 'chapter',
      targetId: id.data,
      before: snapshot(before, KEYS),
      after: snapshot(after, KEYS),
      request,
    })
    purgeCatalog()
    return ok(after ? snapshot(after, KEYS) : null)
  },
)

export const DELETE = withPermission<{ id: string }>(
  'chapter.delete',
  async (request, ctx, user) => {
    const id = idParam.safeParse((await ctx.params).id)
    if (!id.success) return notFound()
    const db = await getDb()
    const now = new Date()
    const [before] = await db
      .select({ deletedAt: chapters.deletedAt })
      .from(chapters)
      .where(eq(chapters.id, id.data))
      .limit(1)
    if (!before) return notFound()
    await db
      .update(chapters)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(chapters.id, id.data))
    await audit({
      actorId: user.id,
      action: 'chapter.delete',
      targetType: 'chapter',
      targetId: id.data,
      before: { deletedAt: before.deletedAt },
      after: { deletedAt: now.toISOString() },
      request,
    })
    purgeCatalog()
    return ok({ id: id.data })
  },
)
