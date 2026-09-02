import { messages } from '@palscans/core/messages'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { withReturn } from '@/lib/auth/return-to'
import { AuthFooterLink, AuthHeading } from '../_components/AuthHeading'
import { Divider, OAuthButtons } from '../_components/OAuthButtons'
import { readAuthParams } from '../_components/params'
import { RegisterForm } from '../_components/RegisterForm'

export const metadata: Metadata = { title: messages.nav.register }

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = readAuthParams(await searchParams)
  const returnTo = params.return ?? '/'
  const user = await getSessionUser()
  if (user) redirect(user.username ? returnTo : withReturn('/onboarding', returnTo))

  return (
    <>
      <AuthHeading
        title={messages.authPage.registerTitle}
        lead={messages.authPage.registerLead}
        gate={params.gate}
      />
      <div className="flex flex-col gap-5">
        <OAuthButtons returnTo={returnTo} />
        <Divider />
        <RegisterForm returnTo={returnTo} />
      </div>
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
