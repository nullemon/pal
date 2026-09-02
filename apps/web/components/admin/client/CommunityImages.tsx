'use client'

import { messages } from '@palscans/core/messages'
import { Button, cn, useToast } from '@palscans/ui'
import { useState } from 'react'
import { postJson } from './api'

interface Item {
  id: number
  url: string
  width: number
  height: number
  tags: string[]
  status: string
  isCollection: boolean
  uploadedBy: string | null
  createdAt: string
}

export function CommunityImages({
  status,
  items,
}: {
  status: 'pending' | 'approved'
  items: Item[]
}) {
  const m = messages.admin.moderation.images
  const { toast } = useToast()
  const [rows, setRows] = useState(items)
  const act = async (id: number, action: 'approve' | 'remove' | 'collection') => {
    const res = await postJson(`/api/admin/comments/images/${id}`, { action })
    if (!res.ok) return toast({ title: messages.admin.errorSaving, tone: 'danger' })
    setRows((rs) =>
      action === 'remove' || status === 'pending'
        ? rs.filter((r) => r.id !== id)
        : rs.map((r) => (r.id === id ? { ...r, isCollection: true } : r)),
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 border-b border-line">
        {(['pending', 'approved'] as const).map((s) => (
          <a
            key={s}
            href={`/admin/comments/images?status=${s}`}
            aria-current={status === s ? 'page' : undefined}
            className={cn(
              '-mb-px h-10 border-b-2 px-3 text-[13px] font-semibold leading-10',
              status === s ? 'border-brand text-fg' : 'border-transparent text-fg-muted',
            )}
          >
            {s === 'pending' ? m.pending : m.approved}
          </a>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface-1 p-10 text-center text-[13px] text-fg-muted">
          {messages.admin.noResults}
        </div>
      ) : null}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex flex-col gap-2 rounded-lg border border-line bg-surface-1 p-2"
          >
            <img
              src={r.url}
              width={r.width}
              height={r.height}
              alt=""
              loading="lazy"
              className="aspect-square w-full rounded-md bg-bg object-contain"
            />
            <div className="truncate text-[11px] text-fg-muted">
              {r.uploadedBy ?? '—'} · {r.tags.join(', ') || m.tags}
            </div>
            <div className="flex flex-wrap gap-1">
              {status === 'pending' ? (
                <Button size="sm" onClick={() => act(r.id, 'approve')}>
                  {m.approve}
                </Button>
              ) : null}
              {!r.isCollection ? (
                <Button size="sm" variant="outline" onClick={() => act(r.id, 'collection')}>
                  {m.addToCollection}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="text-danger"
                onClick={() => act(r.id, 'remove')}
              >
                {m.remove}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
