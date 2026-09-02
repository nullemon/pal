import { can } from '@palscans/core'
import { fmt, messages } from '@palscans/core/messages'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Wordmark } from '@/components/shell/Wordmark'
import { getSessionUser } from '@/lib/auth'
import { safeReturnPath } from '@/lib/auth/return-to'
import { Notice } from '../../../(auth)/_components/fields'
import { LoginForm } from '../../../(auth)/_components/LoginForm'
import { Divider, OAuthButtons } from '../../../(auth)/_components/OAuthButtons'
import { SignOutLink } from './SignOutLink'

const m = messages.staffAuth

export const metadata: Metadata = {
  title: m.title,
  robots: { index: false, follow: false },
}

/**
 * The panel's own door (docs/04). It reuses the reader session, `LoginForm` and its TOTP
 * step rather than standing up a second auth system — the only differences are where you
 * land afterwards and what the page tells you when your account cannot come in.
 */
export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const raw = (await searchParams).return
  const returnTo = safeReturnPath(typeof raw === 'string' ? raw : undefined) ?? '/admin'
  const user = await getSessionUser()
  if (user && can(user, 'admin.access')) redirect(returnTo)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Wordmark />
        <span className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-fg-muted">
          {m.badge}
        </span>
      </div>

      <div className="rounded-lg border border-line bg-surface-1 p-6 shadow-1">
        {user ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-[-0.01em] text-fg">
                {m.noAccessTitle}
              </h1>
              <p className="text-[13px] leading-relaxed text-fg-muted">
                {fmt(m.noAccessLead, { email: user.email ?? user.username ?? '' })}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <SignOutLink label={m.useAnother} />
              <Link
                href="/"
                className="flex h-10 items-center justify-center rounded-md border border-line bg-surface-2 text-[13px] font-semibold text-fg transition-colors hover:border-fg-subtle"
              >
                {m.backToSite}
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-[-0.015em] text-fg">
                {m.title}
              </h1>
              <p className="text-[13px] leading-relaxed text-fg-muted">{m.lead}</p>
            </div>
            <Notice tone="info">{m.twoFactorNote}</Notice>
            <LoginForm returnTo={returnTo} />
            <Divider label={m.oauthLead} />
            <OAuthButtons returnTo={returnTo} stacked />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-[12px] text-fg-subtle">
        <Link href="/login" className="font-semibold hover:text-fg-muted">
          {m.readerSignIn}
        </Link>
        <Link href="/" className="hover:text-fg-muted">
          {m.backToSite}
        </Link>
      </div>
    </div>
  )
}
