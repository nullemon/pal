'use client'

import { useState } from 'react'

/** Signs the current reader account out and stays on the staff door. */
export function SignOutLink({ label }: { label: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'x-requested-with': 'fetch' },
        })
        window.location.reload()
      }}
      className="flex h-10 items-center justify-center rounded-md bg-brand text-[13px] font-bold text-brand-ink transition-colors hover:bg-brand-hover disabled:opacity-60"
    >
      {label}
    </button>
  )
}
