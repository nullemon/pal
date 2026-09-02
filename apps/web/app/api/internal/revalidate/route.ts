import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { purgeAppearance, purgeCatalog, purgeSettings } from '@/components/admin/server/cache'
import { fail, ok, parseJson } from '@/lib/auth'
import { getEnv } from '@/lib/env'

/**
 * POST /api/internal/revalidate — the worker's way into the Next data cache. It runs out of
 * process, so when it publishes a chapter (image pipeline done, or the 30 s scheduler) it
 * cannot call `revalidateTag` itself; it posts the tags here instead. Authenticated with
 * `INTERNAL_API_SECRET` as a bearer token (required in production; development falls back
 * to `SESSION_SECRET`, which both processes share through the root .env). Never mounted for browsers: no cookies,
 * no CSRF, constant-time compare.
 */
const bodySchema = z.object({
  tags: z
    .array(z.enum(['catalog', 'settings', 'appearance']))
    .min(1)
    .max(3),
})

const purge = { catalog: purgeCatalog, settings: purgeSettings, appearance: purgeAppearance }

const authorized = (request: Request): boolean => {
  const env = getEnv()
  const secret = env.INTERNAL_API_SECRET ?? env.SESSION_SECRET
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  if (!authorized(request)) return fail(401, 'unauthorized')
  const parsed = await parseJson(request, bodySchema)
  if (!parsed.ok) return parsed.response
  const tags = [...new Set(parsed.data.tags)]
  for (const tag of tags) purge[tag]()
  return ok({ revalidated: tags })
}
