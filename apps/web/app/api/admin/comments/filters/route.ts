import { getDb, wordFilters } from '@palscans/db'
import { wordFilterSchema } from '@/components/admin/schemas-moderation'
import { audit } from '@/components/admin/server/audit'
import { ok, parseJson, withPermission } from '@/lib/auth'

/** POST /api/admin/comments/filters — add a word filter (block / hold / replace). */
export const POST = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, wordFilterSchema)
  if (!parsed.ok) return parsed.response
  if (parsed.data.isRegex) {
    try {
      new RegExp(parsed.data.pattern, 'i')
    } catch {
      return Response.json({ error: 'validation', message: 'Invalid regex' }, { status: 400 })
    }
  }
  const db = await getDb()
  const [row] = await db
    .insert(wordFilters)
    .values({ ...parsed.data, createdBy: user.id })
    .returning()
  await audit({
    actorId: user.id,
    action: 'settings.word_filter.create',
    targetType: 'word_filter',
    targetId: row?.id ?? null,
    after: parsed.data,
    request,
  })
  return ok(row)
})
