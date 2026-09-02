import { timingSafeEqual } from 'node:crypto'
import { getDb } from '@palscans/db'
import { fail, ok, parseJson } from '@/lib/auth'
import { redeemCode } from '@/lib/discord'
import { discordStatus, getEnv } from '@/lib/env'
import { discordRedeemSchema } from '../../schemas'

/**
 * POST /api/push/discord/redeem — the endpoint the Discord bot calls when a reader types
 * their link code at it (docs/17 §D "per-user account linking via a generated code").
 *
 * This is a machine caller, not a browser: it authenticates with the shared
 * `INTERNAL_API_SECRET` bearer the worker already uses, never a session cookie, so there is
 * no CSRF surface and `requireUser` does not apply. Without `DISCORD_BOT_TOKEN` the whole
 * feature is off and this answers 503 — a deployment with no bot has nothing to link.
 */
const secretMatches = (header: string | null): boolean => {
  const env = getEnv()
  const expected = env.INTERNAL_API_SECRET ?? env.SESSION_SECRET
  const given = header?.startsWith('Bearer ') ? header.slice(7) : ''
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const POST = async (request: Request): Promise<Response> => {
  if (!discordStatus().configured) return fail(503, 'discord_not_configured')
  if (!secretMatches(request.headers.get('authorization'))) return fail(401, 'unauthorized')
  const parsed = await parseJson(request, discordRedeemSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const result = await redeemCode(
    db,
    parsed.data.code,
    parsed.data.discordId,
    parsed.data.discordUsername ?? null,
  )
  if (!result.ok) return fail(400, result.error)
  return ok({ linked: true, userId: result.userId })
}
