'use client'

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, useToast } from '@palscans/ui'
import { useCallback, useState } from 'react'
import {
  EmptyRow,
  Field,
  Hint,
  inputClass,
  Panel,
  PanelHeader,
  Table,
  Td,
  Th,
} from '@/components/admin/ui'

/**
 * Scanlation groups: add, rename, remove.
 *
 * The screen is small because the feature is — the table and the `chapter_groups` join have
 * existed since the schema was written, and what was missing was any way to put a row in
 * them. Crediting happens on the chapters screen, where the chapters are.
 */
const m = adminMessages.groupsAdmin

export interface GroupRow {
  id: number
  slug: string
  name: string
  description: string | null
  chapterCount: number
}

export function GroupsScreen({ initial, canEdit }: { initial: GroupRow[]; canEdit: boolean }) {
  const { toast } = useToast()
  const [rows, setRows] = useState(initial)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const create = useCallback(async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const response = await fetch('/api/admin/groups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      })
      if (!response.ok) throw new Error()
      const body = (await response.json()) as { group: GroupRow }
      setRows((current) => [...current, body.group])
      setName('')
      setDescription('')
      toast({ title: m.created, tone: 'ok' })
    } catch {
      toast({ title: m.failed, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }, [name, description, toast])

  const rename = useCallback(
    async (id: number) => {
      if (!draft.trim()) return
      setBusy(true)
      try {
        const response = await fetch(`/api/admin/groups/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: draft.trim() }),
        })
        if (!response.ok) throw new Error()
        setRows((current) => current.map((r) => (r.id === id ? { ...r, name: draft.trim() } : r)))
        setEditing(null)
        toast({ title: m.updated, tone: 'ok' })
      } catch {
        toast({ title: m.failed, tone: 'danger' })
      } finally {
        setBusy(false)
      }
    },
    [draft, toast],
  )

  const remove = useCallback(
    async (id: number) => {
      if (!confirm(m.confirmRemove)) return
      setBusy(true)
      try {
        const response = await fetch(`/api/admin/groups/${id}`, { method: 'DELETE' })
        if (!response.ok) throw new Error()
        setRows((current) => current.filter((r) => r.id !== id))
        toast({ title: m.removed, tone: 'ok' })
      } catch {
        toast({ title: m.failed, tone: 'danger' })
      } finally {
        setBusy(false)
      }
    },
    [toast],
  )

  return (
    <>
      {canEdit ? (
        <Panel>
          <PanelHeader title={m.create} hint={m.why} />
          <div className="flex flex-wrap items-end gap-3">
            <Field label={m.nameLabel} htmlFor="group-name">
              <input
                id="group-name"
                className={inputClass}
                value={name}
                placeholder={m.namePlaceholder}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
              />
            </Field>
            <Field label={m.descriptionLabel} htmlFor="group-description">
              <input
                id="group-description"
                className={inputClass}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={busy}
              />
            </Field>
            <Button onClick={create} disabled={busy || !name.trim()}>
              {m.create}
            </Button>
          </div>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader title={m.title} />
        <Hint>{m.assignHint}</Hint>
        <Table>
          <thead>
            <tr>
              <Th>{m.nameLabel}</Th>
              <Th>{m.descriptionLabel}</Th>
              <Th align="right">{m.chapters.replace('{n} ', '')}</Th>
              {canEdit ? <Th align="right"> </Th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={canEdit ? 4 : 3}>{m.empty}</EmptyRow> : null}
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-surface-2/60">
                <Td>
                  {editing === row.id ? (
                    <input
                      className={inputClass}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      disabled={busy}
                    />
                  ) : (
                    <span className="font-semibold">{row.name}</span>
                  )}
                </Td>
                <Td className="max-w-[320px] truncate text-fg-muted">{row.description ?? ''}</Td>
                <Td align="right" className="tabular-nums">
                  {row.chapterCount === 1
                    ? m.chaptersOne
                    : fmt(m.chapters, { n: row.chapterCount })}
                </Td>
                {canEdit ? (
                  <Td align="right">
                    {editing === row.id ? (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" onClick={() => rename(row.id)} disabled={busy}>
                          {m.save}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          {m.cancel}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(row.id)
                            setDraft(row.name)
                          }}
                        >
                          {m.edit}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => remove(row.id)}>
                          {m.remove}
                        </Button>
                      </div>
                    )}
                  </Td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </>
  )
}
