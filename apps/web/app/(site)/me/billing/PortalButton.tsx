'use client'

import { messages } from '@palscans/core/messages'
import { Button, useToast } from '@palscans/ui'
import { useState } from 'react'

/**
 * Opens Stripe's Customer Portal — cancel, plan change and card update are its screens, not
 * ours (docs/07). Rendered only when billing is configured and the account has a customer.
 */
export function PortalButton({
  label = messages.billing.manage,
  variant = 'outline',
}: {
  label?: string
  variant?: 'primary' | 'outline'
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const m = messages.billing
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          const res = await fetch('/api/billing/portal', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { accept: 'application/json' },
          })
          const json = (await res.json().catch(() => ({}))) as {
            data?: { url?: string }
            message?: string
          }
          if (res.ok && json.data?.url) {
            window.location.assign(json.data.url)
            return
          }
          toast({ title: m.portalFailed, description: json.message ?? '', tone: 'danger' })
        } catch {
          toast({ title: m.portalFailed, tone: 'danger' })
        }
        setBusy(false)
      }}
    >
      {busy ? m.portalBusy : label}
    </Button>
  )
}
