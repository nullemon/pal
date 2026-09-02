import { fmt, messages } from '@palscans/core/messages'
import { getDb, oauthAccounts, users } from '@palscans/db'
import { Button } from '@palscans/ui'
import { eq } from 'drizzle-orm'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSessionId, listSessions } from '@/lib/auth'
import { describeDevice } from '@/lib/auth/device'
import { listLoginEvents } from '@/lib/auth/login-events'
import { OAUTH_PROVIDERS, providerConfigured } from '@/lib/auth/oauth'
import { PageTitle, Section } from '../_components/Section'
import {
  ChangePasswordForm,
  type SessionRow,
  SessionsList,
  TotpPanel,
} from '../_components/SecurityForms'
import { requireAccount } from '../_lib'
import { LoginHistoryTable } from './LoginHistoryTable'

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
  // docs/17 §C: the reader's own sign-in history, paginated on `?lp=`.
  const rawPage = typeof params.lp === 'string' ? Number.parseInt(params.lp, 10) : 1
  const historyPage = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), 500) : 1
  const sessionId = await getSessionId()
  const history = await listLoginEvents(user.id, historyPage)
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
          id="login-history"
          title={messages.me.security.loginHistory}
          description={messages.me.security.loginHistoryHint}
        >
          <LoginHistoryTable
            rows={history.rows}
            currentSessionId={sessionId}
            page={historyPage}
            pages={history.pages}
          />
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
                    aria-disabled={!providerConfigured(p)}
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
