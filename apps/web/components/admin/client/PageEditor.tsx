'use client'

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, useToast } from '@palscans/ui'
import { useCallback, useEffect, useState } from 'react'
import { Hint, Panel, PanelHeader, Pill } from '@/components/admin/ui'

/**
 * The page grid: drag to reorder, select to delete, save once.
 *
 * Nothing is written until Save. A misdrag in a 200-page chapter is otherwise a silent
 * corruption of reading order that nobody notices until a reader complains, and the operator
 * has no way back short of re-uploading — which is the problem this screen exists to remove.
 * So the arrangement is staged locally, Discard restores the server's copy, and the Save is
 * one request the server applies atomically.
 *
 * Pages are addressed by id, never by position. A staged delete plus a staged drag would
 * otherwise disagree about what "page 4" means depending on which the operator did first.
 *
 * Reordering is source-level under the hood: a long strip cut into several pages moves as a
 * block, because processing regenerates those pages together from one original and any other
 * behaviour would be undone by the next run. Rather than let the grid imply otherwise, such
 * pages are marked and the server's resulting order replaces the local one after every save.
 */
const m = adminMessages.pageEditor

export interface EditorPage {
  id: string
  idx: number
  width: number
  height: number
  blurHash: string | null
  url: string
  split: boolean
}

interface Props {
  chapterId: number
  initial: EditorPage[]
  editable: boolean
}

export function PageEditor({ chapterId, initial, editable }: Props) {
  const { toast } = useToast()
  const [server, setServer] = useState<EditorPage[]>(initial)
  const [pages, setPages] = useState<EditorPage[]>(initial)
  const [doomed, setDoomed] = useState<Set<string>>(new Set())
  const [dragging, setDragging] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setServer(initial)
    setPages(initial)
    setDoomed(new Set())
  }, [initial])

  const reordered = pages.some((p, i) => server[i]?.id !== p.id)
  const dirty = reordered || doomed.size > 0

  const move = useCallback((from: number, to: number) => {
    setPages((current) => {
      if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length)
        return current
      const next = [...current]
      const [held] = next.splice(from, 1)
      if (held) next.splice(to, 0, held)
      return next
    })
  }, [])

  const toggleDoomed = useCallback((id: string) => {
    setDoomed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const discard = useCallback(() => {
    setPages(server)
    setDoomed(new Set())
  }, [server])

  const save = useCallback(async () => {
    setSaving(true)
    try {
      const response = await fetch(`/api/admin/chapters/${chapterId}/pages`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          order: pages.map((p) => p.id),
          deleted: [...doomed],
        }),
      })
      if (!response.ok) throw new Error(String(response.status))
      const body = (await response.json()) as { pages?: EditorPage[] }
      // The server's arrangement replaces the local one rather than being assumed to match:
      // dragging one page of a split strip moves the whole strip, so what was asked for and
      // what happened can legitimately differ, and the grid must show what happened.
      const next = body.pages ?? []
      setServer(next)
      setPages(next)
      setDoomed(new Set())
      toast({ title: m.saved, tone: 'ok' })
    } catch {
      toast({ title: m.failed, tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }, [chapterId, pages, doomed, toast])

  if (!editable)
    return (
      <Panel>
        <PanelHeader title={m.title} />
        <Hint>{m.notProcessed}</Hint>
      </Panel>
    )

  return (
    <Panel>
      <PanelHeader
        title={m.title}
        aside={
          <div className="flex items-center gap-2">
            {doomed.size > 0 ? (
              <Pill tone="danger">{fmt(m.selected, { n: doomed.size })}</Pill>
            ) : null}
            {dirty ? (
              <>
                <Button variant="ghost" size="sm" onClick={discard} disabled={saving}>
                  {m.discard}
                </Button>
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving ? m.saving : m.save}
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <Hint>{pages.length === 1 ? m.countOne : fmt(m.count, { n: pages.length })}</Hint>
      <Hint>{m.dragHint}</Hint>
      {pages.some((p) => p.split) ? <Hint>{m.splitHint}</Hint> : null}
      {dirty ? (
        <p className="mt-2 text-sm text-warn" role="status">
          {m.unsaved}
        </p>
      ) : null}

      {pages.length === 0 ? (
        <Hint>{m.empty}</Hint>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {pages.map((page, index) => {
            const gone = doomed.has(page.id)
            return (
              <li
                key={page.id}
                draggable={!saving}
                onDragStart={() => setDragging(page.id)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  const from = pages.findIndex((p) => p.id === dragging)
                  if (from >= 0) move(from, index)
                  setDragging(null)
                }}
                className={[
                  'relative rounded-lg border bg-surface-2 p-2 transition',
                  gone ? 'border-danger opacity-45' : 'border-border',
                  dragging === page.id ? 'ring-2 ring-brand' : '',
                ].join(' ')}
              >
                {/* biome-ignore lint/performance/noImgElement: a signed, short-lived thumbnail URL */}
                <img
                  src={page.url}
                  alt={fmt(m.page, { n: index + 1 })}
                  width={page.width}
                  height={page.height}
                  loading="lazy"
                  className="aspect-[2/3] w-full rounded object-cover"
                />
                <div className="mt-2 flex items-center justify-between gap-1">
                  <span className="text-xs tabular-nums text-fg-subtle">{index + 1}</span>
                  {page.split ? <Pill tone="neutral">{m.strip}</Pill> : null}
                </div>
                <div className="mt-1 flex items-center gap-1">
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 text-xs hover:bg-surface-3"
                    onClick={() => move(index, index - 1)}
                    disabled={index === 0 || saving}
                    aria-label={m.moveLeft}
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 text-xs hover:bg-surface-3"
                    onClick={() => move(index, index + 1)}
                    disabled={index === pages.length - 1 || saving}
                    aria-label={m.moveRight}
                  >
                    →
                  </button>
                  <button
                    type="button"
                    className="ml-auto rounded px-1.5 py-0.5 text-xs hover:bg-surface-3"
                    onClick={() => toggleDoomed(page.id)}
                    disabled={saving}
                  >
                    {gone ? m.restore : '✕'}
                  </button>
                </div>
                {gone ? <span className="sr-only">{m.pendingDelete}</span> : null}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
