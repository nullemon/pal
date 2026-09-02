'use client'

import { messages } from '@palscans/core/messages'
import { Button, useToast } from '@palscans/ui'
import { useState } from 'react'
import { Field, inputClass, selectClass } from '../ui'
import { postJson } from './api'

export function NewSeriesForm() {
  const [title, setTitle] = useState('')
  const [type, setType] = useState('manhwa')
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  const f = messages.admin.series.fields
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        const res = await postJson<{ id: number; slug: string }>('/api/admin/series', {
          title,
          type,
        })
        setBusy(false)
        if (!res.ok) {
          toast({ title: messages.admin.errorSaving, description: res.message, tone: 'danger' })
          return
        }
        window.location.href = `/admin/series/${res.data.id}`
      }}
    >
      <Field label={f.title} htmlFor="ns-title">
        <input
          id="ns-title"
          className={inputClass}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </Field>
      <Field label={f.type} htmlFor="ns-type">
        <select
          id="ns-type"
          className={selectClass}
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {['manhwa', 'manhua', 'manga', 'comic', 'novel'].map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      <div>
        <Button type="submit" disabled={busy || !title.trim()}>
          {messages.admin.series.newSeries}
        </Button>
      </div>
    </form>
  )
}
