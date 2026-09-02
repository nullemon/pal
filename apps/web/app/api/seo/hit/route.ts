import { z } from 'zod'
import { proxyToken, recordRedirectHit } from '@/lib/seo/snapshot'

const bodySchema = z.object({ path: z.string().min(1).max(2048).startsWith('/') })

/** Internal: proxy.ts reports a redirect hit; authenticated with the derived proxy token. */
export async function POST(request: Request) {
  if (request.headers.get('x-proxy-token') !== proxyToken())
    return Response.json({ error: 'forbidden' }, { status: 403 })
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return Response.json({ error: 'validation' }, { status: 400 })
  await recordRedirectHit(parsed.data.path)
  return Response.json({ data: { ok: true } })
}
