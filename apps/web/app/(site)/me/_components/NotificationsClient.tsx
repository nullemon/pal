'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Button, cn, RelativeTime, useToast } from '@palscans/ui'
import { Bell, CheckCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { NOTIFICATION_CHANNELS, NOTIFICATION_KINDS } from '@/lib/auth/schemas'
import { api } from './api'

export interface NotificationItem {
  id: number
  kind: string
  title: string
  body: string | null
  href: string | null
  read: boolean
  createdAt: string
}

export interface PrefRow {
  kind: (typeof NOTIFICATION_KINDS)[number]
  channel: (typeof NOTIFICATION_CHANNELS)[number]
  enabled: boolean
}

export function MarkAllReadButton({ unread }: { unread: number }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const mark = async () => {
    setBusy(true)
    const res = await api<{ message: string }>('/api/me/notifications', {})
    setBusy(false)
    toast.toast({ title: res.ok ? res.data.message : res.message })
    if (res.ok) router.refresh()
  }
  return (
    <Button variant="outline" size="sm" onClick={mark} disabled={busy || unread === 0}>
      <CheckCheck size={14} aria-hidden="true" />
      {messages.me.notifications.markAllRead}
    </Button>
  )
}

export function NotificationRow({ item }: { item: NotificationItem }) {
  const inner = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'mt-1.5 size-2 shrink-0 rounded-full',
          item.read ? 'bg-transparent' : 'bg-brand',
        )}
      />
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-fg-muted">
        <Bell size={15} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block text-sm leading-snug',
            item.read ? 'text-fg-muted' : 'font-semibold text-fg',
          )}
        >
          {item.title}
        </span>
        {item.body ? (
          <span className="mt-0.5 block text-[12px] text-fg-muted">{item.body}</span>
        ) : null}
        <RelativeTime iso={item.createdAt} className="mt-1 block text-[11px] text-fg-subtle" />
      </span>
    </>
  )
  const cls = 'flex items-start gap-3 p-3 transition-colors hover:bg-surface-2'
  return item.href ? (
    <a href={item.href} className={cls}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  )
}

export function PrefsMatrix({ initial }: { initial: PrefRow[] }) {
  const toast = useToast()
  const [prefs, setPrefs] = useState(initial)
  const [busy, setBusy] = useState(false)
  const toggle = (kind: PrefRow['kind'], channel: PrefRow['channel']) =>
    setPrefs((p) =>
      p.map((r) => (r.kind === kind && r.channel === channel ? { ...r, enabled: !r.enabled } : r)),
    )
  const save = async () => {
    setBusy(true)
    const res = await api<{ saved: boolean }>('/api/me/notifications/prefs', { prefs }, 'PUT')
    setBusy(false)
    toast.toast({ title: res.ok ? messages.account.saved : res.message })
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-[13px]">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-[0.08em] text-fg-subtle">
              <th className="py-2 pr-3 font-bold">{messages.me.notifications.title}</th>
              {NOTIFICATION_CHANNELS.map((c) => (
                <th key={c} className="px-2 py-2 text-center font-bold">
                  {messages.me.notifications.channels[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {NOTIFICATION_KINDS.map((kind) => (
              <tr key={kind}>
                <td className="py-2.5 pr-3 text-fg">{messages.me.notifications.kinds[kind]}</td>
                {NOTIFICATION_CHANNELS.map((channel) => {
                  const row = prefs.find((r) => r.kind === kind && r.channel === channel)
                  return (
                    <td key={channel} className="px-2 py-2.5 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${messages.me.notifications.kinds[kind]} · ${messages.me.notifications.channels[channel]}`}
                        checked={row?.enabled ?? true}
                        onChange={() => toggle(kind, channel)}
                        className="size-4 accent-brand"
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <Button size="sm" onClick={save} disabled={busy}>
          {messages.account.save}
        </Button>
      </div>
    </div>
  )
}

export const unreadLabel = (n: number) => fmt(messages.me.notifications.unread, { n })
