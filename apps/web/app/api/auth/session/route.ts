import { getSessionUser, ok } from '@/lib/auth'

/** GET /api/auth/session — the lean signed-in user for client components, or null. */
export async function GET(): Promise<Response> {
  const user = await getSessionUser()
  return ok(
    user
      ? {
          id: user.id,
          role: user.role,
          username: user.username ?? null,
          emailVerified: !!user.emailVerifiedAt,
        }
      : null,
    { headers: { 'cache-control': 'private, no-store' } },
  )
}
