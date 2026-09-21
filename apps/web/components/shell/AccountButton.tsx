'use client'

import { messages } from '@palscans/core/messages'
import { LogIn } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

/**
 * The account control in the header.
 *
 * It used to be a hardcoded link to `/login` showing a literal "R", for everyone, signed in
 * or not — so a signed-in reader clicking their own avatar was sent to the sign-in page,
 * which redirected them back to the home page. That loop was the only thing the control did,
 * and there was no way to reach account settings from the chrome at all.
 *
 * A client island rather than a server read: `app/(site)/layout.tsx` holds nothing
 * request-scoped on purpose, because a `cookies()` call in that tree makes every page under
 * it dynamic and costs the series pages their prerender (docs/06). So the shell stays static
 * and this one hole fills itself in after hydration.
 *
 * It renders the signed-out state first and swaps — which is correct for the visitor who is
 * genuinely signed out (the overwhelming majority, and the only ones who see it for long),
 * and a brief flicker for the reader who is not. The alternative, rendering nothing until the
 * answer arrives, moves the rest of the header when it lands; this way the box is the same
 * size in both states and nothing shifts.
 */
interface Summary {
  signedIn: boolean
  username: string | null
  initial: string
  staff: boolean
}

const base =
  'hidden size-[38px] shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-[13px] font-bold text-fg-muted transition-colors hover:text-fg sm:inline-flex'

export function AccountButton() {
  const [me, setMe] = useState<Summary | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/me/summary', { credentials: 'same-origin', signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (body?.data?.signedIn) setMe(body.data as Summary)
      })
      // Offline, or the request was cut short by a navigation: the signed-out state is
      // already on screen and is the safe thing to leave there.
      .catch(() => {})
    return () => controller.abort()
  }, [])

  if (!me) {
    return (
      <Link
        href="/login"
        aria-label={messages.nav.signIn}
        title={messages.nav.signIn}
        className={base}
      >
        <LogIn size={17} aria-hidden="true" />
      </Link>
    )
  }

  const name = me.username ?? messages.account.profile
  return (
    <Link
      href="/me/settings"
      aria-label={name}
      title={name}
      className={`${base} border-brand/40 text-fg`}
    >
      {me.initial}
    </Link>
  )
}
