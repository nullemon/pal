'use client'

import { messages } from '@palscans/core/messages'
import { Button } from '@palscans/ui'
import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function SignOutButton({
  everywhere = false,
  className,
}: {
  everywhere?: boolean
  className?: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const signOut = async () => {
    setBusy(true)
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ everywhere }),
      credentials: 'same-origin',
    }).catch(() => undefined)
    router.push('/')
    router.refresh()
  }
  return (
    <Button variant="ghost" size="sm" onClick={signOut} disabled={busy} className={className}>
      <LogOut size={14} aria-hidden="true" />
      {everywhere ? messages.auth.signOutEverywhere : messages.nav.signOut}
    </Button>
  )
}
