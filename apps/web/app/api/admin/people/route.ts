import { getDb, people } from '@palscans/db'
import { ilike } from 'drizzle-orm'
import { z } from 'zod'
import { ok, parseQuery, withPermission } from '@/lib/auth'

const q = z.object({ q: z.string().trim().min(1).max(100) })

/** GET /api/admin/people?q= — author/artist typeahead. */
export const GET = withPermission('series.read', async (request) => {
  const parsed = parseQuery(request, q)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const rows = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(ilike(people.name, `%${parsed.data.q}%`))
    .limit(10)
  return ok(rows)
})
