import { ok } from '@/lib/auth'
import { pushStatus } from '@/lib/env'
import { pushConfig } from '@/lib/notifications'

/**
 * GET /api/push/key — the VAPID application server key the browser needs to subscribe.
 *
 * Public by design: it is the *public* half of the pair and every subscriber must have it.
 * With no keys configured it answers `{ configured: false }` rather than 404, so the panel
 * can say "not configured" instead of looking broken.
 */
export const GET = async (): Promise<Response> => {
  const status = await pushStatus()
  const cfg = await pushConfig()
  return ok({
    configured: status.configured,
    missing: status.missing,
    publicKey: cfg?.publicKey ?? null,
  })
}
