import { messages } from '@palscans/core/messages'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { AuthHeading } from '../_components/AuthHeading'
import { OnboardingForm } from '../_components/OnboardingForm'
import { readAuthParams } from '../_components/params'

export const metadata: Metadata = { title: messages.authPage.onboardingTitle }

/** After an OAuth sign-up: the account exists but has no username yet. */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = readAuthParams(await searchParams)
  const returnTo = params.return ?? '/'
  const user = await requireUser({ returnTo: '/onboarding' })
  if (user.username) redirect(returnTo)
  return (
    <>
      <AuthHeading
        title={messages.authPage.onboardingTitle}
        lead={messages.authPage.onboardingLead}
      />
      <OnboardingForm returnTo={returnTo} />
    </>
  )
}
