import { loadSuggestions } from '@/components/requests/server/data'
import { suggestLimit } from '@/components/requests/server/guards'
import { readActor } from '@/components/requests/server/identity'
import { suggestQuerySchema } from '@/components/requests/shared'
import { ok, parseQuery, rateLimited } from '@/lib/auth'

/**
 * `GET /api/requests/suggest?q=` — what the modal shows while somebody types: series the
 * site already has (through `searchSeries`, the one series search there is) and requests
 * somebody already filed. Both halves in one round trip, because this runs on keystrokes.
 *
 * Read-only and idempotent, so no Origin check; it is budgeted per minute because it is the
 * one public endpoint here that a page can fire repeatedly without a click.
 */
export async function GET(request: Request) {
  const parsed = parseQuery(request, suggestQuerySchema)
  if (!parsed.ok) return parsed.response
  const actor = await readActor()
  const limit = await suggestLimit(actor)
  if (!limit.ok) return rateLimited(limit.retryAfterSec)
  const data = await loadSuggestions(parsed.data.q, actor)
  return ok(data, { headers: { 'cache-control': 'private, no-store' } })
}
