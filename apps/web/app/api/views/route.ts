import { z } from 'zod'
import { fail, ok, parseJson, sameOrigin } from '@/lib/auth'
import { getSessionUser } from '@/lib/auth/session'
import { recorder, viewerFor } from '@/lib/views/record'

/**
 * POST /api/views — "this reader is looking at this page" (docs/02 "Views and ranking").
 *
 * Reported by `navigator.sendBeacon` from `ViewBeacon` after the page has been visible for
 * a moment, never during a render: docs/02 is explicit that `UPDATE ... SET view_count =
 * view_count + 1` per page view is the thing not to do, and a synchronous INSERT per view
 * is only marginally better. The handler decides whether the view counts and hands it to an
 * in-process buffer that writes batches; nothing here waits on the database.
 *
 * The answer is always 202 with what happened, so a beacon never retries and a duplicate is
 * not an error. Nothing about the outcome is worth hiding — it tells a script only what it
 * could measure anyway.
 */
const bodySchema = z.object({
  seriesId: z.number().int().positive(),
  /** 0 (or absent) is the series page itself. */
  chapterId: z.number().int().min(0).default(0),
})

export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail(403, 'forbidden')
  const parsed = await parseJson(request, bodySchema)
  if (!parsed.ok) return parsed.response

  const user = await getSessionUser().catch(() => null)
  const outcome = await recorder().record({
    seriesId: parsed.data.seriesId,
    chapterId: parsed.data.chapterId,
    ...viewerFor(request, user?.id ?? null),
  })
  return ok({ outcome }, { status: 202 })
}
