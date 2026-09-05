import { messages } from '@palscans/core/messages'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { readRegistrationMode } from '@/lib/auth/invites'
import { withReturn } from '@/lib/auth/return-to'
import { siteCopy } from '@/lib/copy/settings'
import { AuthFooterLink, AuthHeading } from '../_components/AuthHeading'
import { Notice } from '../_components/fields'
import { Divider, OAuthButtons } from '../_components/OAuthButtons'
import { readAuthParams } from '../_components/params'
import { RegisterForm } from '../_components/RegisterForm'

export const metadata: Metadata = { title: messages.nav.register }

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const raw = await searchParams
  const params = readAuthParams(raw)
  const returnTo = params.return ?? '/'
  const user = await getSessionUser()
  if (user) redirect(user.username ? returnTo : withReturn('/onboarding', returnTo))
  // docs/17 §C: the operator's registration mode decides what this page offers.
  const [mode, copy] = await Promise.all([readRegistrationMode(), siteCopy()])
  const invite = typeof raw.invite === 'string' ? raw.invite.slice(0, 32) : ''

  return (
    <>
      <AuthHeading
        title={messages.authPage.registerTitle}
        lead={copy('authPage.registerLead')}
        gate={params.gate}
      />
      {mode === 'closed' ? (
        <Notice tone="info">{messages.auth.registrationClosed}</Notice>
      ) : (
        <div className="flex flex-col gap-5">
          <OAuthButtons returnTo={returnTo} />
          <Divider />
          <RegisterForm
            returnTo={returnTo}
            inviteRequired={mode === 'invite'}
            initialInvite={invite}
          />
        </div>
      )}
      <AuthFooterLink>
        {messages.auth.haveAccount}{' '}
        <Link
          href={withReturn('/login', returnTo, params.gate ? { gate: params.gate } : undefined)}
          className="font-semibold text-brand-hover hover:underline"
        >
          {messages.auth.signIn}
        </Link>
      </AuthFooterLink>
    </>
  )
}
