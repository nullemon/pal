import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { fail, ok, parseJson } from '@/lib/auth'
import { purgeDueDeletions } from '@/lib/auth/users'
import { getEnv } from '@/lib/env'

/**
 * POST /api/internal/maintenance — periodic jobs that have to run inside the web app.
 *
 * Account deletion is the one that matters. A reader who asks to delete their account is
 * told "deletion scheduled for {date}", and `purgeDueDeletions` implements exactly that
 * after the grace period — but nothing ever called it, so the promise was never kept and
 * the data stayed. It lives in the web app (it reaches for session revocation and the
 * message catalogue), and the scheduler lives in the worker, so the worker asks here.
 *
 * Same authentication as /api/internal/revalidate: `INTERNAL_API_SECRET` as a bearer token,
 * constant-time compare, no cookies, never mounted for browsers.
 */
const bodySchema = z.object({
  tasks: z
    .array(z.enum(['deletions']))
    .min(1)
    .max(1),
})

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
  const purged = await purgeDueDeletions()
  return ok({ deletions: purged.length })
}
