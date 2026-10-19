'use client'

import { messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, useToast } from '@palscans/ui'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { del, postJson } from '@/components/admin/client/api'
import {
  EmptyRow,
  Field,
  Hint,
  inputClass,
  Num,
  Panel,
  PanelHeader,
  selectClass,
  Table,
  Td,
  Th,
} from '@/components/admin/ui'

/**
 * Admin → Links: short paths on the site that send people somewhere else.
 *
 * The same table the SEO screen's redirects panel writes, under the name the operator
 * actually thinks in. That panel exists for the SEO job — a moved page, a dead URL — and
 * this one for the marketing job: /discord in a bio, /x on a credit page, a tag on each so
 * Analytics can say which one worked. One mechanism, two doors, because putting "where
 * does /discord point today" behind a page called SEO is why nobody found it.
 */
const m = adminMessages.links

export interface LinkRow {
  id: number
  fromPath: string
  toPath: string
  status: number
  hits: number
}

export function LinksScreen({ initial, origin }: { initial: LinkRow[]; origin: string }) {
  const { toast } = useToast()
  const [rows, setRows] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState<301 | 302>(302)

  const save = useCallback(
    async (path: string, target: string, kind: number) => {
      if (!path.startsWith('/') || target.trim() === '') {
        toast({ title: m.invalid, tone: 'danger' })
        return false
      }
      setBusy(true)
      const res = await postJson<{ redirect: LinkRow }>('/api/admin/seo/redirects', {
        from: path,
        to: target,
        status: kind,
      })
      setBusy(false)
      if (!res.ok) {
        toast({ title: res.message || messages.errors.generic, tone: 'danger' })
        return false
      }
      const saved = res.data.redirect
      setRows((current) => {
        const without = current.filter((r) => r.fromPath !== saved.fromPath)
        return [{ ...saved, hits: Number(saved.hits ?? 0) }, ...without]
      })
      toast({ title: m.saved, tone: 'ok' })
      return true
    },
    [toast],
  )

  const remove = useCallback(
    async (row: LinkRow) => {
      setBusy(true)
      const res = await del<{ id: number }>('/api/admin/seo/redirects', { id: row.id })
      setBusy(false)
      if (!res.ok) {
        toast({ title: res.message || messages.errors.generic, tone: 'danger' })
        return
      }
      setRows((current) => current.filter((r) => r.id !== row.id))
      toast({ title: m.removed, tone: 'ok' })
    },
    [toast],
  )

  const copy = useCallback(
    (path: string) => {
      // `navigator.clipboard` is unavailable over plain HTTP and in some in-app browsers;
      // the toast would otherwise claim a copy that never happened.
      void navigator.clipboard
        ?.writeText(`${origin}${path}`)
        .then(() => toast({ title: m.copied, tone: 'ok' }))
        .catch(() => toast({ title: `${origin}${path}`, tone: 'neutral' }))
    },
    [origin, toast],
  )

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader title={m.title} hint={m.subtitle} />
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto_auto]">
          <Field label={m.path} hint={m.pathHint} htmlFor="link-path">
            <input
              className={inputClass}
              id="link-path"
              onChange={(e) => setFrom(e.target.value)}
              placeholder="/discord"
              value={from}
            />
          </Field>
          <Field label={m.target} hint={m.targetHint} htmlFor="link-target">
            <input
              className={inputClass}
              id="link-target"
              onChange={(e) => setTo(e.target.value)}
              placeholder="https://discord.gg/…"
              value={to}
            />
          </Field>
          <Field label={m.kind} htmlFor="link-kind">
            <select
              className={selectClass}
              id="link-kind"
              onChange={(e) => setStatus(Number(e.target.value) === 301 ? 301 : 302)}
              value={status}
            >
              <option value={302}>{m.temporary}</option>
              <option value={301}>{m.permanent}</option>
            </select>
          </Field>
          <Button
            className="self-end"
            disabled={busy}
            onClick={() =>
              void save(from.trim(), to.trim(), status).then((ok) => {
                if (ok) {
                  setFrom('')
                  setTo('')
                }
              })
            }
          >
            <Plus aria-hidden className="size-4" />
            {busy ? m.saving : m.add}
          </Button>
        </div>
        <Hint>{m.kindHint}</Hint>
        <Hint>{m.tagHint}</Hint>
      </Panel>

      <Panel>
        <Table>
          <thead>
            <tr>
              <Th>{m.path}</Th>
              <Th>{m.target}</Th>
              <Th>{m.clicks}</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={4}>{m.none}</EmptyRow>
            ) : (
              rows.map((row) => (
                <LinkRowView
                  key={row.id}
                  busy={busy}
                  onCopy={copy}
                  onRemove={remove}
                  onSave={save}
                  row={row}
                />
              ))
            )}
          </tbody>
        </Table>
      </Panel>
    </div>
  )
}

/** One row, with its destination editable in place — changing it is the whole point. */
function LinkRowView({
  row,
  busy,
  onSave,
  onRemove,
  onCopy,
}: {
  row: LinkRow
  busy: boolean
  onSave: (path: string, target: string, kind: number) => Promise<boolean>
  onRemove: (row: LinkRow) => Promise<void>
  onCopy: (path: string) => void
}) {
  const [target, setTarget] = useState(row.toPath)
  const dirty = target.trim() !== row.toPath

  return (
    <tr>
      <Td>
        <span className="font-medium">{row.fromPath}</span>
      </Td>
      <Td>
        <input className={inputClass} onChange={(e) => setTarget(e.target.value)} value={target} />
      </Td>
      <Td>
        <Num>{row.hits.toLocaleString()}</Num>
      </Td>
      <Td>
        <div className="flex items-center justify-end gap-1">
          {dirty ? (
            <Button
              disabled={busy}
              onClick={() => void onSave(row.fromPath, target.trim(), row.status)}
              size="sm"
            >
              {m.save}
            </Button>
          ) : null}
          <Button onClick={() => onCopy(row.fromPath)} size="sm" variant="ghost">
            <Copy aria-hidden className="size-3.5" />
            {m.copy}
          </Button>
          <Button
            className="text-danger"
            disabled={busy}
            onClick={() => void onRemove(row)}
            size="sm"
            variant="ghost"
          >
            <Trash2 aria-hidden className="size-3.5" />
          </Button>
        </div>
      </Td>
    </tr>
  )
}
