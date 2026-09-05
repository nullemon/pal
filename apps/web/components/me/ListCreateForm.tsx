'use client'

import { messages } from '@palscans/core/messages'
import { Button, useToast } from '@palscans/ui'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api, inputClasses, labelClasses } from '@/app/(site)/me/_components/api'

/** Create a reading list (docs/13). Name only; everything else is edited on the list page. */
export function ListCreateForm() {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const m = messages.me.lists

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      toast.toast({ title: m.nameRequired })
      return
    }
    setBusy(true)
    const res = await api<{ list: { id: number }; message: string }>('/api/lists', {
      name: name.trim(),
    })
    setBusy(false)
    toast.toast({ title: res.ok ? res.data.message : res.message })
    if (!res.ok) return
    setName('')
    setOpen(false)
    router.push(`/me/lists/${res.data.list.id}`)
  }

  if (!open)
    return (
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden="true" />
        {m.create}
      </Button>
    )

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div className="min-w-[220px] flex-1">
        <label className={labelClasses} htmlFor="new-list-name">
          {m.name}
        </label>
        <input
          id="new-list-name"
          className={`${inputClasses} mt-1`}
          value={name}
          maxLength={60}
          placeholder={m.namePlaceholder}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <Button type="submit" variant="primary" size="md" disabled={busy}>
        {m.create}
      </Button>
      <Button type="button" variant="outline" size="md" onClick={() => setOpen(false)}>
        {messages.nav.close}
      </Button>
    </form>
  )
}
