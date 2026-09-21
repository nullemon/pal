import { fmt, messages } from '@palscans/core/messages'
import { getDb, oauthAccounts, users } from '@palscans/db'
import { Button } from '@palscans/ui'
import { eq } from 'drizzle-orm'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSessionId, listSessions } from '@/lib/auth'
import { describeDevice } from '@/lib/auth/device'
import { OAUTH_PROVIDERS, type OAuthProvider, providerConfigured } from '@/lib/auth/oauth'
import { PageTitle, Section } from '../_components/Section'
import {
  ChangePasswordForm,
  type SessionRow,
  SessionsList,
  TotpPanel,
} from '../_components/SecurityForms'
import { requireAccount } from '../_lib'

export const metadata: Metadata = { title: messages.me.security.title }

const providerLabel: Record<(typeof OAUTH_PROVIDERS)[number], string> = {
  google: 'Google',
  discord: 'Discord',
}

/** Security — sessions with revoke, password change, TOTP, connected providers (docs/07). */
export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireAccount('/me/security')
  const params = await searchParams
  const totpRequired = params.totp === 'required'
  const sessionId = await getSessionId()
  const db = await getDb()
  const [[row], sessions, linked] = await Promise.all([
    db
      .select({
        passwordHash: users.passwordHash,
        totpEnabledAt: users.totpEnabledAt,
        lastLoginMethod: users.lastLoginMethod,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1),
    listSessions(user.id, sessionId),
    db
      .select({ provider: oauthAccounts.provider })
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, user.id)),
  ])
  if (!row) notFound()
  // docs/19: which providers have keys is resolved from the admin panel first, the
  // environment second — so the buttons are computed once here rather than per row.
  const configured = await Promise.all(
    OAUTH_PROVIDERS.map(
      async (p): Promise<[OAuthProvider, boolean]> => [p, await providerConfigured(p)],
    ),
  )
  const configuredProviders = new Set(configured.filter(([, ok]) => ok).map(([p]) => p))
  const rows: SessionRow[] = sessions.map((s) => {
    const device = describeDevice(s.userAgent)
    return {
      id: s.id,
      browser: device?.browser ?? messages.me.security.unknownDevice,
      os: device?.os ?? '',
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
      current: s.current,
    }
  })
  const linkedSet = new Set(linked.map((l) => l.provider))
  const signupProvider =
    row.lastLoginMethod === 'google' || row.lastLoginMethod === 'discord'
      ? providerLabel[row.lastLoginMethod]
      : 'OAuth'

  return (
    <>
      <PageTitle title={messages.me.security.title} />
      <div className="flex flex-col gap-6">
        <Section
          id="sessions"
          title={messages.me.security.sessions}
          description={messages.me.security.sessionsHint}
        >
          <SessionsList sessions={rows} />
        </Section>

        <Section
          id="password"
          title={messages.me.security.password}
          description={messages.me.security.passwordHint}
        >
          {row.passwordHash ? (
            <ChangePasswordForm />
          ) : (
            <p className="text-[13px] text-fg-muted">
              {fmt(messages.me.security.noPassword, { provider: signupProvider })}
            </p>
          )}
        </Section>

        <Section
          id="totp"
          title={messages.me.security.totp}
          description={messages.me.security.totpHint}
        >
          {totpRequired && !row.totpEnabledAt ? (
            <p className="mb-3 text-[13px] text-warn" role="status">
              {messages.errors.totpRequired}
            </p>
          ) : null}
          <TotpPanel enabled={!!row.totpEnabledAt} hasPassword={!!row.passwordHash} />
        </Section>

        <Section
          id="connected"
          title={messages.me.security.connected}
          description={messages.me.security.connectedHint}
        >
          <ul className="divide-y divide-line-soft rounded-md border border-line">
            {OAUTH_PROVIDERS.map((p) => (
              <li key={p} className="flex items-center justify-between gap-3 p-3">
                <div>
                  <p className="text-sm font-semibold text-fg">{providerLabel[p]}</p>
                  <p className="text-[12px] text-fg-muted">
                    {linkedSet.has(p) ? (
                      <span className="text-ok">
                        {messages.me.security.totpOn === 'On' ? 'Connected' : 'Connected'}
                      </span>
                    ) : (
                      messages.me.security.notConnected
                    )}
                  </p>
                </div>
                {linkedSet.has(p) ? null : (
                  <Button
                    href={`/api/auth/${p}?return=%2Fme%2Fsecurity`}
                    variant="outline"
                    size="sm"
                    aria-disabled={!configuredProviders.has(p)}
                  >
                    {messages.me.security.connect}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  )
}
