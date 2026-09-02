import { messages } from '@palscans/core/messages'
import { getDb, users } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { csrfFailed, fail, ok, parseJson, sameOrigin } from '@/lib/auth'
import { verifyQuerySchema } from '@/lib/auth/schemas'
import { consumeToken } from '@/lib/auth/tokens'

/** POST /api/auth/verify {token} — the /verify page posts the link's token (mail scanners only GET). */
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return csrfFailed()
  const parsed = await parseJson(request, verifyQuerySchema)
  if (!parsed.ok) return parsed.response
  const consumed = await consumeToken(parsed.data.token, 'verify_email')
  if (!consumed) return fail(400, 'token_invalid', messages.authPage.verifyInvalid)
  const db = await getDb()
  await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, consumed.userId))
  return ok({ verified: true, message: messages.auth.verified })
}
