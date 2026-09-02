'use client'

import { messages } from '@palscans/core/messages'
import { Button, useToast } from '@palscans/ui'
import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api } from './api'

export function ClearHistoryButton() {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const clear = async () => {
    if (!window.confirm(`${messages.me.history.clear}?`)) return
    setBusy(true)
    const res = await api<{ message: string }>('/api/me/history', undefined, 'DELETE')
    setBusy(false)
    toast.toast({ title: res.ok ? res.data.message : res.message })
    if (res.ok) router.refresh()
  }
  return (
    <Button variant="outline" size="sm" onClick={clear} disabled={busy}>
      <Trash2 size={14} aria-hidden="true" />
      {messages.me.history.clear}
    </Button>
  )
}
