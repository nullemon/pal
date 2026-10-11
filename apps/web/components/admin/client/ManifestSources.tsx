'use client'

import { fmt, messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, useToast } from '@palscans/ui'
import { AlertTriangle, RefreshCw, Rss } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Panel, PanelHeader, Pill } from '../ui'
import { api, del, patchJson } from './api'
import { relativeTime } from './util'

/**
 * The manifest links this series follows (docs/03 "Keeping a manifest in sync").
 *
 * The panel exists mostly so the sync is not invisible. An unattended importer that quietly
 * stops working — the gist was deleted, the host started refusing us, the file was edited
 * into invalid JSON — leaves an operator believing the site is current when it has been stuck
 * for a month. So every row says when it was last checked and, if that check failed, why.
 */

export interface ManifestSourceRow {
  id: number
  url: string
  language: string
  store: 'remote' | 'storage'
  publishMode: 'ready' | 'publish'
  active: boolean
  lastCheckedAt: string | null
  lastChangedAt: string | null
  lastError: string | null
  imported: number
}

const m = adminMessages.admin.manifestSync

/**
 * Re-reading the list after an import is the parent's job, through `key`.
 *
 * It remounts this panel, which re-runs the fetch below — one mechanism instead of a reload
 * counter threaded through a dependency array, and nothing here has state worth preserving
 * across a refresh.
 */
export function ManifestSources({ seriesId, canEdit }: { seriesId: number; canEdit: boolean }) {
  const { toast } = useToast()
  const [rows, setRows] = useState<ManifestSourceRow[]>([])
  const [busy, setBusy] = useState<number | null>(null)

  const load = useCallback(async () => {
    const result = await api<{ sources: ManifestSourceRow[] }>(
      `/api/admin/series/${seriesId}/manifest-sources`,
    )
    if (result.ok) setRows(result.data.sources)
  }, [seriesId])

  useEffect(() => {
    void load()
  }, [load])

  const patch = useCallback(
    async (id: number, body: { active?: boolean; check?: boolean }) => {
      setBusy(id)
      const result = await patchJson<{ source: ManifestSourceRow; queued: boolean }>(
        `/api/admin/series/${seriesId}/manifest-sources`,
        { id, ...body },
      )
      setBusy(null)
      if (!result.ok) {
        toast({ title: result.message || messages.errors.generic, tone: 'danger' })
        return
      }
      setRows((current) => current.map((r) => (r.id === id ? result.data.source : r)))
      if (body.check)
        toast({
          title: result.data.queued ? m.checkQueued : m.checkNoQueue,
          tone: result.data.queued ? 'ok' : 'neutral',
        })
    },
    [seriesId, toast],
  )

  const forget = useCallback(
    async (id: number) => {
      if (!confirm(m.confirmForget)) return
      setBusy(id)
      const result = await del(`/api/admin/series/${seriesId}/manifest-sources`, { id })
      setBusy(null)
      if (!result.ok) {
        toast({ title: result.message || messages.errors.generic, tone: 'danger' })
        return
      }
      setRows((current) => current.filter((r) => r.id !== id))
      toast({ title: m.forgotten, tone: 'ok' })
    },
    [seriesId, toast],
  )

  // Nothing followed and nothing to say: the import panel above is where following starts, so
  // an empty panel here would be a permanent instruction to do something they may not want.
  if (rows.length === 0) return null

  return (
    <Panel>
      <PanelHeader title={m.title} hint={m.hint} />
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li
            className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-3"
            key={row.id}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Rss aria-hidden className="size-4 shrink-0 text-fg-muted" />
              <a
                className="min-w-0 flex-1 truncate text-[13px] text-accent underline-offset-2 hover:underline"
                href={row.url}
                rel="noreferrer noopener"
                target="_blank"
              >
                {row.url}
              </a>
              <Pill tone="neutral">{row.language}</Pill>
              {row.active ? null : <Pill tone="warn">{m.paused}</Pill>}
              {row.lastError ? (
                <Pill tone="danger">
                  <AlertTriangle aria-hidden className="size-3" /> {m.failing}
                </Pill>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-fg-muted">
              <span>
                {row.lastCheckedAt
                  ? fmt(m.checked, { ago: relativeTime(row.lastCheckedAt) })
                  : m.never}
              </span>
              <span>
                {row.imported === 1 ? m.importedOne : fmt(m.imported, { n: row.imported })}
              </span>
              <span>{row.publishMode === 'publish' ? m.publishes : m.drafts}</span>
              <span>{row.store === 'storage' ? m.stored : m.remote}</span>
            </div>
            {/* The reason, verbatim. "Sync failed" alone is not something an operator can act on. */}
            {row.lastError ? <p className="text-[12.5px] text-danger">{row.lastError}</p> : null}
            {canEdit ? (
              <div className="flex flex-wrap gap-1.5">
                <Button
                  disabled={busy === row.id}
                  onClick={() => void patch(row.id, { check: true })}
                  size="sm"
                  variant="outline"
                >
                  <RefreshCw aria-hidden className="size-3.5" />
                  {busy === row.id ? m.checking : m.checkNow}
                </Button>
                <Button
                  disabled={busy === row.id}
                  onClick={() => void patch(row.id, { active: !row.active })}
                  size="sm"
                  variant="ghost"
                >
                  {row.active ? m.pause : m.resume}
                </Button>
                <Button
                  className="text-danger"
                  disabled={busy === row.id}
                  onClick={() => void forget(row.id)}
                  size="sm"
                  variant="ghost"
                >
                  {m.forget}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  )
}
