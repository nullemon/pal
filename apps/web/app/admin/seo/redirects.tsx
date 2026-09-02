'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Button, useToast } from '@palscans/ui'
import { Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { del, postJson } from '@/components/admin/client/api'
import {
  EmptyRow,
  Field,
  inputClass,
  Num,
  Panel,
  PanelHeader,
  Pill,
  selectClass,
  Table,
  Td,
  Th,
  textareaClass,
} from '@/components/admin/ui'
import { Iso, type RedirectView } from './shared'

const m = messages.adminSeo.redirects

interface RedirectRow {
  id: number
  fromPath: string
  toPath: string
  status: number
  hits: number | string
  createdAt: string
}

const toView = (r: RedirectRow): RedirectView => ({
  id: r.id,
  from: r.fromPath,
  to: r.toPath,
  status: r.status,
  hits: Number(r.hits),
  createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date(r.createdAt).toISOString(),
})

export function RedirectsPanel({ initial }: { initial: RedirectView[] }) {
  const id = useId()
  const { toast } = useToast()
  const [rows, setRows] = useState(initial)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState<301 | 302>(301)
  const [csv, setCsv] = useState('')
  const [busy, setBusy] = useState(false)

  const add = async () => {
    setBusy(true)
    const res = await postJson<{ redirect: RedirectRow }>('/api/admin/seo/redirects', {
      from,
      to,
      status,
    })
    setBusy(false)
    if (!res.ok)
      return toast({ title: messages.admin.errorSaving, description: res.message, tone: 'danger' })
    const view = toView(res.data.redirect)
    setRows((r) => [view, ...r.filter((x) => x.id !== view.id)])
    setFrom('')
    setTo('')
    toast({ title: messages.admin.saved, tone: 'ok' })
  }

  const remove = async (row: RedirectView) => {
    const res = await del<{ id: number }>('/api/admin/seo/redirects', { id: row.id })
    if (!res.ok)
      return toast({ title: messages.admin.errorSaving, description: res.message, tone: 'danger' })
    setRows((r) => r.filter((x) => x.id !== row.id))
  }

  const importCsv = async () => {
    setBusy(true)
    const res = await postJson<{
      imported: number
      errors: { line: number; message: string }[]
      redirects: RedirectRow[]
    }>('/api/admin/seo/redirects/import', { csv })
    setBusy(false)
    if (!res.ok)
      return toast({ title: messages.admin.errorSaving, description: res.message, tone: 'danger' })
    setRows(res.data.redirects.map(toView))
    setCsv('')
    toast({
      title: fmt(m.imported, { n: res.data.imported }),
      description: res.data.errors.length
        ? res.data.errors
            .map((e) => `L${e.line}: ${e.message}`)
            .slice(0, 3)
            .join(' · ')
        : undefined,
      tone: res.data.errors.length ? 'neutral' : 'ok',
    })
  }

  return (
    <>
      <Panel>
        <PanelHeader title={m.title} hint={m.hint} />
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_auto] md:items-end">
          <Field label={m.from} htmlFor={`${id}-from`}>
            <input
              id={`${id}-from`}
              className={`${inputClass} font-mono`}
              value={from}
              placeholder="/manga/solo-leveling"
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label={m.to} htmlFor={`${id}-to`}>
            <input
              id={`${id}-to`}
              className={`${inputClass} font-mono`}
              value={to}
              placeholder="/series/solo-leveling"
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <Field label={m.status} htmlFor={`${id}-status`}>
            <select
              id={`${id}-status`}
              className={selectClass}
              value={status}
              onChange={(e) => setStatus(Number(e.target.value) === 302 ? 302 : 301)}
            >
              <option value={301}>301</option>
              <option value={302}>302</option>
            </select>
          </Field>
          <Button onClick={add} disabled={busy || !from || !to}>
            {m.add}
          </Button>
        </div>
        <Table className="mt-4">
          <thead>
            <tr>
              <Th>{m.from}</Th>
              <Th>{m.to}</Th>
              <Th align="center">{m.status}</Th>
              <Th align="right">{m.hits}</Th>
              <Th>{m.created}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={6}>{m.empty}</EmptyRow> : null}
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="font-mono text-[12px]">{r.from}</Td>
                <Td className="font-mono text-[12px] text-fg-muted">{r.to}</Td>
                <Td align="center">
                  <Pill tone={r.status === 302 ? 'warn' : 'brand'}>{r.status}</Pill>
                </Td>
                <Td align="right">
                  <Num>{r.hits}</Num>
                </Td>
                <Td>
                  <Iso value={r.createdAt} />
                </Td>
                <Td align="right">
                  <button
                    type="button"
                    onClick={() => remove(r)}
                    aria-label={m.delete}
                    className="inline-flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-danger"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <Panel>
        <PanelHeader title={m.import} hint={m.importHint} />
        <textarea
          rows={6}
          spellCheck={false}
          className={`${textareaClass} font-mono text-[12px]`}
          value={csv}
          placeholder={m.csvPlaceholder}
          onChange={(e) => setCsv(e.target.value)}
        />
        <div className="mt-3">
          <Button variant="outline" onClick={importCsv} disabled={busy || !csv.trim()}>
            {m.import}
          </Button>
        </div>
      </Panel>
    </>
  )
}
