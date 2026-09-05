import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { fail, ok, parseJson, withPermission } from '@/lib/auth'
import { getEnv } from '@/lib/env'
import { validateUrlSchema } from '@/lib/seo/admin'
import { extractJsonLd, jsonLdTypes, validateJsonLd } from '@/lib/seo/jsonld'

/** Fetch a page on this site, pull out its JSON-LD and run the builders' required-field checks. */
const m = adminMessages.adminSeo.tools

/** Outside production a dev server on another port may be validated too. */
const LOCALHOST_HTTP = /^http:\/\/localhost(:\d+)?$/

export const POST = withPermission('settings.write', async (request) => {
  const parsed = await parseJson(request, validateUrlSchema)
  if (!parsed.ok) return parsed.response
  const env = getEnv()
  const origin = new URL(env.SITE_URL).origin
  let target: URL
  try {
    target = new URL(parsed.data.url, origin)
  } catch {
    return fail(400, 'validation', m.invalidUrl)
  }
  // Only the configured site origin is fetched — never whatever Host the request arrived
  // with — so the validator cannot be pointed at internal addresses.
  const localDev = env.NODE_ENV !== 'production' && LOCALHOST_HTTP.test(target.origin)
  if (target.origin !== origin && !localDev) return fail(400, 'same_origin_only')
  let html: string
  try {
    const res = await fetch(target, {
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
