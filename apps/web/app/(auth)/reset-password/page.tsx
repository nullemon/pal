import { messages } from '@palscans/core/messages'
import type { Metadata } from 'next'
import Link from 'next/link'
import { peekToken } from '@/lib/auth/tokens'
import { AuthFooterLink, AuthHeading } from '../_components/AuthHeading'
import { Notice } from '../_components/fields'
import { readAuthParams } from '../_components/params'
import { ResetForm } from '../_components/ResetForm'

export const metadata: Metadata = { title: messages.auth.resetPassword }

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = readAuthParams(await searchParams)
  const valid = params.token ? await peekToken(params.token, 'reset_password') : null
  return (
    <>
      <AuthHeading title={messages.authPage.resetTitle} lead={messages.authPage.resetLead} />
      {valid && params.token ? (
        <ResetForm token={params.token} />
      ) : (
        <div className="flex flex-col gap-4">
          <Notice tone="error">{messages.authPage.resetInvalid}</Notice>
          <Link
            href="/forgot-password"
            className="text-center text-[13px] font-semibold text-brand-hover hover:underline"
          >
            {messages.authPage.forgotCta}
          </Link>
        </div>
      )}
      <AuthFooterLink>
        <Link href="/login" className="font-semibold text-brand-hover hover:underline">
          {messages.auth.signIn}
        </Link>
      </AuthFooterLink>
    </>
  )
}
