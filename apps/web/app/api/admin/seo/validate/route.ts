import { fmt, messages } from '@palscans/core/messages'
import { fail, ok, parseJson, withPermission } from '@/lib/auth'
import { getEnv } from '@/lib/env'
import { validateUrlSchema } from '@/lib/seo/admin'
import { extractJsonLd, jsonLdTypes, validateJsonLd } from '@/lib/seo/jsonld'

/** Fetch a page on this site, pull out its JSON-LD and run the builders' required-field checks. */
const m = messages.adminSeo.tools

export const POST = withPermission('settings.write', async (request) => {
  const parsed = await parseJson(request, validateUrlSchema)
  if (!parsed.ok) return parsed.response
  const origin = new URL(getEnv().SITE_URL).origin
  let target: URL
  try {
    target = new URL(parsed.data.url, origin)
  } catch {
    return fail(400, 'validation', m.invalidUrl)
  }
  const requestOrigin = new URL(request.url).origin
  if (target.origin !== origin && target.origin !== requestOrigin)
    return fail(400, 'same_origin_only')
  // Fetch through the origin the request came in on (works on any port locally).
  const fetchUrl = new URL(target.pathname + target.search, requestOrigin)
  let html: string
  try {
    const res = await fetch(fetchUrl, {
      headers: { accept: 'text/html', 'user-agent': 'PALScans-JSONLD-Validator' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return fail(502, 'fetch_failed', fmt(m.httpStatus, { status: res.status }))
    html = await res.text()
  } catch (err) {
    return fail(502, 'fetch_failed', err instanceof Error ? err.message : m.fetchFailed)
  }
  const { parsed: blocks, errors } = extractJsonLd(html)
  const result = validateJsonLd(blocks)
  return ok({
    url: target.toString(),
    blocks: blocks.length,
    types: jsonLdTypes(blocks),
    ok: result.ok && errors.length === 0,
    issues: [...errors.map((message) => ({ type: 'json', field: '', message })), ...result.issues],
    jsonld: blocks,
  })
})
