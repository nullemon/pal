import { getDb } from '@palscans/db'
import { z } from 'zod'
import { ok, parseQuery, withPermission } from '@/lib/auth'
import { seriesOptions } from '@/lib/seo/admin-data'

const querySchema = z.object({ q: z.string().trim().max(100).optional() })

/** Series picker for the template preview. */
export const GET = withPermission('settings.write', async (request) => {
  const parsed = parseQuery(request, querySchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  return ok({ series: await seriesOptions(db, parsed.data.q) })
})
