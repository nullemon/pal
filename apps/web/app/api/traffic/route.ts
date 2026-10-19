import { z } from 'zod'
import { fail, ok, parseJson, sameOrigin } from '@/lib/auth'
import { countTraffic } from '@/lib/views/traffic'

/**
 * POST /api/traffic — "this visit arrived from here" (docs/13).
 *
 * One call per browser session, from `TrafficBeacon` in the site layout, carrying the
 * referrer the browser already sends on the navigation itself and the `?ref=` tag from the
 * URL. Nothing identifying is sent, nothing identifying is stored: the handler buckets the
 * referrer into a source and increments a per-day counter.
 *
 * The referrer is read from the body rather than the `Referer` header because the header on
 * *this* request is the site's own page — the only thing that knows where the visit came
 * from is the document, and only at the moment it loads.
 *
 * Always 202: a beacon must never retry, and there is no outcome worth telling a script.
 */
const bodySchema = z.object({
  /** `document.referrer`. Capped well above any real URL and parsed defensively. */
  referrer: z.string().max(2048).optional(),
  /** The `?ref=` tag on the link that was clicked. */
  ref: z.string().max(64).optional(),
})

export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail(403, 'forbidden')
  const parsed = await parseJson(request, bodySchema)
  if (!parsed.ok) return parsed.response
  countTraffic(parsed.data.referrer ?? null, parsed.data.ref ?? null)
  return ok({ counted: true }, { status: 202 })
}
