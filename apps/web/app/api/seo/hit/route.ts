import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { ok, parseJson } from '@/lib/auth'
import { proxyToken, recordRedirectHit } from '@/lib/seo/snapshot'

const bodySchema = z.object({ path: z.string().min(1).max(2048).startsWith('/') })

/** Constant-time check of the shared proxy token (length first, then every byte). */
const tokenMatches = (header: string | null): boolean => {
  const given = Buffer.from(header ?? '')
  const expected = Buffer.from(proxyToken())
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** Internal: proxy.ts reports a redirect hit; authenticated with the derived proxy token. */
export async function POST(request: Request) {
  if (!tokenMatches(request.headers.get('x-proxy-token')))
    return Response.json({ error: 'forbidden' }, { status: 403 })
  const parsed = await parseJson(request, bodySchema)
  if (!parsed.ok) return parsed.response
  await recordRedirectHit(parsed.data.path)
  return ok({ ok: true })
}
