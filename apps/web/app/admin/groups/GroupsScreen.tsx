'use client'

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, useToast } from '@palscans/ui'
import { useCallback, useState } from 'react'
import { del, patchJson, postJson } from '@/components/admin/client/api'
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

  /**
   * Through `postJson`, not a hand-rolled fetch.
   *
   * Every admin route answers `{ data: … }`, and reading `body.group` off the raw response
   * got `undefined` — which was then pushed into the table and rendered, taking the whole
   * page down with it. The shared helper unwraps the envelope and types the result, so this
   * cannot drift from the routes again.
   */
  const create = useCallback(async () => {
    if (!name.trim()) return
    setBusy(true)
    const result = await postJson<{ group: GroupRow }>('/api/admin/groups', {
      name: name.trim(),
      description: description.trim() || null,
    })
    setBusy(false)
    if (!result.ok || !result.data.group) {
      toast({ title: result.ok ? m.failed : result.message || m.failed, tone: 'danger' })
      return
    }
    setRows((current) => [...current, result.data.group])
    setName('')
    setDescription('')
    toast({ title: m.created, tone: 'ok' })
  }, [name, description, toast])

  const rename = useCallback(
    async (id: number) => {
      if (!draft.trim()) return
      setBusy(true)
      const result = await patchJson(`/api/admin/groups/${id}`, { name: draft.trim() })
      setBusy(false)
      if (!result.ok) {
        toast({ title: result.message || m.failed, tone: 'danger' })
        return
      }
      setRows((current) => current.map((r) => (r.id === id ? { ...r, name: draft.trim() } : r)))
      setEditing(null)
      toast({ title: m.updated, tone: 'ok' })
    },
    [draft, toast],
  )

  const remove = useCallback(
    async (id: number) => {
      if (!confirm(m.confirmRemove)) return
      setBusy(true)
      const result = await del(`/api/admin/groups/${id}`)
      setBusy(false)
      if (!result.ok) {
        toast({ title: result.message || m.failed, tone: 'danger' })
        return
      }
      setRows((current) => current.filter((r) => r.id !== id))
      toast({ title: m.removed, tone: 'ok' })
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
