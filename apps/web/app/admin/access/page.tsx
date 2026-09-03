import { messages } from '@palscans/core/messages'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import {
  inviteState,
  listInvites,
  readAccessSetting,
  readMinAccountAgeMinutes,
  readRegistrationMode,
} from '@/lib/auth/invites'
import { turnstileConfigured } from '@/lib/auth/turnstile'
import { getEnv } from '@/lib/env'
import { AccessScreen } from './AccessScreen'

/**
 * Admin → System → Access (docs/17 §C). Registration mode, email-domain rules, the
 * verification and Turnstile switches, the comment minimum-account-age, and the invite codes
 * the register route asks for while the mode is `invite`.
 */
export default async function AccessPage() {
  await withPermission('settings.write', { returnTo: '/admin/access' })
  const [registration, access, minAccountAgeMinutes, invites, turnstile] = await Promise.all([
    readRegistrationMode(),
    readAccessSetting(),
    readMinAccountAgeMinutes(),
    listInvites(),
    turnstileConfigured(),
  ])
  const now = new Date()
  const m = messages.admin.access
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <AccessScreen
        initial={{ registration, access, minAccountAgeMinutes }}
        turnstileConfigured={turnstile}
        trustedProxy={getEnv().TRUSTED_PROXY !== 'none'}
        invites={invites.map((i) => ({
          state: inviteState(i, now),
          id: i.id,
          code: i.code,
          maxUses: i.maxUses,
          uses: i.uses,
          note: i.note,
          expiresAt: i.expiresAt?.toISOString() ?? null,
          createdAt: i.createdAt.toISOString(),
          revokedAt: i.revokedAt?.toISOString() ?? null,
        }))}
      />
    </>
  )
}
