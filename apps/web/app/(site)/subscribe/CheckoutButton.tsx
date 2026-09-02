'use client'

import { messages } from '@palscans/core/messages'
import { Button, useToast } from '@palscans/ui'
import { useState } from 'react'

/**
 * The only client code in the subscribe flow: POST the plan, follow the URL Stripe hands back
 * (docs/07 — hosted Checkout, no card data here). Every failure is a message, never a crash;
 * with billing unconfigured the button is not rendered at all.
 */
export function CheckoutButton({
  planId,
  label,
  variant = 'primary',
}: {
  planId: string
  label: string
  variant?: 'primary' | 'outline'
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const m = messages.billing

  return (
    <Button
      size="lg"
      variant={variant}
      className="mt-auto"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          const res = await fetch('/api/billing/checkout', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ planId }),
          })
          const json = (await res.json().catch(() => ({}))) as {
            data?: { url?: string }
            message?: string
          }
          if (res.ok && json.data?.url) {
            window.location.assign(json.data.url)
            return
          }
          toast({
            title: m.checkoutFailed,
            description: json.message ?? '',
            tone: 'danger',
          })
        } catch {
          toast({ title: m.checkoutFailed, tone: 'danger' })
        }
        setBusy(false)
      }}
    >
      {busy ? m.checkoutBusy : label}
    </Button>
  )
}
