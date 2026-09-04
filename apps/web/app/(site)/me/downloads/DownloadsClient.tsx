'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Button, EmptyState, useToast } from '@palscans/ui'
import { CloudOff, Download, HardDrive, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { clearChapters } from '@/lib/offline/db'
import { formatBytes } from '@/lib/offline/format'
import { useDownloads } from '@/lib/offline/useDownloads'

const m = messages.me.downloads

/**
 * `/me/downloads` — what this device is holding (docs/17 §G). Everything here is local: the
 * server never learns what was downloaded, so the list is built from IndexedDB on mount.
 */
export function DownloadsClient() {
  const { supported, rows, usage, refresh, remove } = useDownloads()
  const { toast } = useToast()
  const [busy, setBusy] = useState<number | null>(null)

  if (!supported)
    return (
      <EmptyState
        icon={<CloudOff size={28} aria-hidden="true" />}
        title={m.unsupported}
        description={m.unsupportedLead}
      />
    )

  if (rows === null)
    return <p className="py-10 text-center text-sm text-fg-muted">{messages.common.loading}</p>

  if (rows.length === 0)
    return (
      <EmptyState
        icon={<Download size={28} aria-hidden="true" />}
        title={m.empty}
        description={m.emptyLead}
        action={
          <Button href="/browse" variant="outline" size="sm">
            {m.browse}
          </Button>
        }
      />
    )

  const total = rows.reduce((n, r) => n + r.bytes, 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-surface-1 px-4 py-3">
        <p className="m-0 flex items-center gap-2 text-[13px] text-fg-muted">
          <HardDrive size={15} aria-hidden="true" className="shrink-0" />
          <span>
            {fmt(m.count, { n: String(rows.length) })} ·{' '}
            {usage && usage.quota > 0
              ? fmt(m.quota, {
                  used: formatBytes(total),
                  total: formatBytes(usage.quota),
                })
              : fmt(m.size, { size: formatBytes(total) })}
          </span>
        </p>
        <button
          type="button"
          className="text-[13px] font-semibold text-danger hover:underline"
          onClick={async () => {
            if (!window.confirm(m.removeAllConfirm)) return
            const { CACHE_NAME } = await import('@/lib/offline/cache')
            await caches.delete(CACHE_NAME).catch(() => false)
            await clearChapters().catch(() => undefined)
            await refresh()
            toast({ title: m.removed, tone: 'ok' })
          }}
        >
          {m.removeAll}
        </button>
      </div>

      <ul className="flex list-none flex-col gap-2 p-0">
        {rows.map((r) => (
          <li
            key={r.chapterId}
            className="flex items-center gap-3 rounded-[12px] border border-line bg-surface-1 p-3"
          >
            <div className="min-w-0 flex-1">
              <Link
                href={`/offline?c=${r.chapterId}`}
                className="block truncate text-sm font-semibold text-fg hover:text-brand-hover"
              >
                {r.seriesTitle}
              </Link>
              <p className="m-0 truncate text-[12px] text-fg-muted">
                {r.label} · {fmt(m.pages, { n: String(r.pageCount) })} · {formatBytes(r.bytes)}
              </p>
            </div>
            <Button href={`/offline?c=${r.chapterId}`} variant="outline" size="sm">
              {m.read}
            </Button>
            <button
              type="button"
              aria-label={`${m.remove} — ${r.seriesTitle} ${r.label}`}
              disabled={busy === r.chapterId}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-[9px] border border-line text-fg-muted transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
              onClick={async () => {
                setBusy(r.chapterId)
                await remove(r.chapterId)
                setBusy(null)
                toast({ title: m.removed, tone: 'ok' })
              }}
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
