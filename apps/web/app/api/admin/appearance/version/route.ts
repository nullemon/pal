import { z } from 'zod'
import { APPEARANCE_SCOPES } from '@/lib/appearance/scope'
import { versionWithBase } from '@/lib/appearance/versions'
import { notFound, ok, parseQuery, withPermission } from '@/lib/auth'

const querySchema = z.object({
  scope: z.enum(APPEARANCE_SCOPES),
  id: z.coerce.number().int().positive(),
})

/**
 * `GET /api/admin/appearance/version?scope=brand&id=42` — one stored version and the one
 * published before it, so the history modal can show what that publish changed
 * (docs/15 "History: each publish is a version with a diff").
 *
 * Fetched on demand rather than shipped with the page. A copy version can carry thirty
 * strings of up to 20 000 characters; thirty of those in the initial payload would be a
 * megabyte of JSON on a screen where the operator usually opens none of them.
 */
export const GET = withPermission('settings.write', async (request) => {
  const parsed = parseQuery(request, querySchema)
  if (!parsed.ok) return parsed.response
  const found = await versionWithBase(parsed.data.scope, parsed.data.id)
  if (!found) return notFound()
  return ok(found)
})
