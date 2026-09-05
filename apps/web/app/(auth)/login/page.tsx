import { fmt, messages } from '@palscans/core/messages'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { withReturn } from '@/lib/auth/return-to'
import { siteCopy } from '@/lib/copy/settings'
import { AuthFooterLink, AuthHeading } from '../_components/AuthHeading'
import { Notice } from '../_components/fields'
import { LoginForm } from '../_components/LoginForm'
import { Divider, OAuthButtons } from '../_components/OAuthButtons'
import { providerName, readAuthParams } from '../_components/params'

export const metadata: Metadata = { title: messages.auth.signIn }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = readAuthParams(await searchParams)
  const returnTo = params.return ?? '/'
  const [user, copy] = await Promise.all([getSessionUser(), siteCopy()])
  if (user && !params.link) redirect(user.username ? returnTo : withReturn('/onboarding', returnTo))

  const errorText =
    params.error === 'banned'
      ? messages.auth.banned
      : params.error === 'oauth_unavailable'
        ? fmt(messages.authPage.oauthUnavailable, { provider: providerName(params.provider) })
        : params.error === 'oauth_no_email'
          ? fmt(messages.authPage.oauthNoEmail, { provider: providerName(params.provider) })
          : params.error === 'oauth_failed'
            ? fmt(messages.authPage.oauthFailed, { provider: providerName(params.provider) })
            : null

  return (
    <>
      <AuthHeading
        title={
          params.link
            ? fmt(messages.authPage.linkTitle, { provider: providerName(params.link) })
            : messages.authPage.signInTitle
        }
        lead={params.link ? messages.auth.signInTagline : copy('authPage.signInLead')}
        gate={params.gate}
      />
      <div className="flex flex-col gap-5">
        {errorText ? <Notice tone="error">{errorText}</Notice> : null}
        {params.reset ? <Notice tone="ok">{messages.authPage.resetDone}</Notice> : null}
        {params.linked ? (
          <Notice tone="ok">
            {fmt(messages.authPage.linked, { provider: providerName(params.linked) })}
          </Notice>
        ) : null}
        <LoginForm
          returnTo={returnTo}
          email={params.link ? params.email : undefined}
          linkProvider={params.link}
        />
        {params.link ? null : (
          <>
            <Divider />
            <OAuthButtons returnTo={returnTo} />
          </>
        )}
      </div>
      <AuthFooterLink>
        {messages.auth.noAccount}{' '}
        <Link
          href={withReturn('/register', returnTo, params.gate ? { gate: params.gate } : undefined)}
          className="font-semibold text-brand-hover hover:underline"
        >
          {messages.nav.register}
        </Link>
      </AuthFooterLink>
    </>
  )
}
