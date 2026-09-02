import { fmt, messages } from '@palscans/core/messages'
import type { Metadata } from 'next'
import { getSessionUser } from '@/lib/auth'
import { AuthHeading } from '../_components/AuthHeading'
import { Notice } from '../_components/fields'
import { readAuthParams } from '../_components/params'
import { ResendButton, VerifyPanel } from '../_components/VerifyPanel'

export const metadata: Metadata = { title: messages.auth.verifyEmail }

/** `/verify?token=…` consumes the link; `/verify` alone is the "check your inbox" state. */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = readAuthParams(await searchParams)
  const returnTo = params.return ?? '/'
  const user = await getSessionUser()
  return (
    <>
      <AuthHeading title={messages.authPage.verifyTitle} lead={messages.auth.verifySent} />
      {params.token ? (
        <VerifyPanel token={params.token} returnTo={returnTo} />
      ) : user?.emailVerifiedAt ? (
        <Notice tone="ok">{messages.auth.verified}</Notice>
      ) : (
        <div className="flex flex-col gap-4">
          <Notice tone="info">
            {user?.email
              ? fmt(messages.authPage.verifyPending, { email: user.email })
              : messages.auth.verifySent}
          </Notice>
          <ResendButton />
        </div>
      )}
    </>
  )
}
