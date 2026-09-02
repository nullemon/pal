import { messages } from '@palscans/core/messages'
import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthFooterLink, AuthHeading } from '../_components/AuthHeading'
import { ForgotForm } from '../_components/ForgotForm'

export const metadata: Metadata = { title: messages.auth.resetPassword }

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHeading title={messages.authPage.forgotTitle} lead={messages.authPage.forgotLead} />
      <ForgotForm />
      <AuthFooterLink>
        <Link href="/login" className="font-semibold text-brand-hover hover:underline">
          {messages.common.back}
        </Link>
      </AuthFooterLink>
    </>
  )
}
