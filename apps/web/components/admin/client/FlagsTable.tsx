'use client'

import { messages } from '@palscans/core/messages'
import { Button, useToast } from '@palscans/ui'
import { X } from 'lucide-react'
import { useState } from 'react'
import { inputClass, selectClass, Table, Td, Th } from '../ui'
import { del, putJson } from './api'

interface Flag {
  key: string
  enabled: 'off' | 'on' | 'percentage'
  percentage: number
  description: string | null
}

export function FlagsTable({ initial }: { initial: Flag[] }) {
  const m = messages.admin.settings.flags
  const { toast } = useToast()
  const [rows, setRows] = useState(initial)
  const [draft, setDraft] = useState<Flag>({
    key: '',
    enabled: 'off',
    percentage: 0,
    description: '',
  })
  const save = async (f: Flag) => {
    const res = await putJson<Flag>('/api/admin/flags', {
      ...f,
      description: f.description || null,
    })
    if (!res.ok)
      return toast({ title: messages.admin.errorSaving, description: res.message, tone: 'danger' })
    setRows((rs) =>
      rs.some((r) => r.key === f.key)
        ? rs.map((r) => (r.key === f.key ? res.data : r))
        : [...rs, res.data].sort((a, b) => a.key.localeCompare(b.key)),
    )
    toast({ title: messages.admin.saved, tone: 'ok' })
  }
  const row = (f: Flag, isDraft: boolean) => (
    <tr key={isDraft ? '__new' : f.key}>
      <Td>
        {isDraft ? (
          <input
            className={`${inputClass} font-mono text-[12px]`}
            placeholder={m.key}
            value={f.key}
            onChange={(e) => setDraft({ ...draft, key: e.target.value })}
          />
        ) : (
          <code className="text-[12px] font-semibold">{f.key}</code>
        )}
      </Td>
      <Td>
        <input
          className={inputClass}
          placeholder={m.description}
          value={f.description ?? ''}
          onChange={(e) =>
            isDraft
              ? setDraft({ ...draft, description: e.target.value })
              : setRows((rs) =>
                  rs.map((r) => (r.key === f.key ? { ...r, description: e.target.value } : r)),
                )
          }
        />
      </Td>
      <Td>
        <select
          className={`${selectClass} w-36`}
          value={f.enabled}
          onChange={(e) =>
            isDraft
              ? setDraft({ ...draft, enabled: e.target.value as Flag['enabled'] })
              : setRows((rs) =>
                  rs.map((r) =>
                    r.key === f.key ? { ...r, enabled: e.target.value as Flag['enabled'] } : r,
                  ),
                )
          }
          aria-label={m.state}
        >
          <option value="off">{m.states.off}</option>
          <option value="on">{m.states.on}</option>
          <option value="percentage">{m.states.percentage}</option>
        </select>
      </Td>
      <Td>
        <input
          type="number"
          min={0}
          max={100}
          className={`${inputClass} w-24`}
          value={f.percentage}
          disabled={f.enabled !== 'percentage'}
          onChange={(e) =>
            isDraft
              ? setDraft({ ...draft, percentage: Number(e.target.value) })
              : setRows((rs) =>
                  rs.map((r) =>
                    r.key === f.key ? { ...r, percentage: Number(e.target.value) } : r,
                  ),
                )
          }
          aria-label={m.percentage}
        />
      </Td>
      <Td align="right">
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant={isDraft ? 'primary' : 'outline'}
            disabled={isDraft && !draft.key}
            onClick={() =>
              void save(f).then(
                () =>
                  isDraft && setDraft({ key: '', enabled: 'off', percentage: 0, description: '' }),
              )
            }
          >
            {isDraft ? m.addFlag : messages.common.save}
          </Button>
          {!isDraft ? (
            <button
              type="button"
              aria-label={messages.admin.remove}
              className="inline-flex size-8 items-center justify-center rounded-md text-fg-muted hover:text-danger"
              onClick={() =>
                void del('/api/admin/flags', { key: f.key }).then(
                  (r) => r.ok && setRows((rs) => rs.filter((x) => x.key !== f.key)),
                )
              }
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      </Td>
    </tr>
  )
  return (
    <Table>
      <thead>
        <tr>
          <Th>{m.key}</Th>
          <Th>{m.description}</Th>
          <Th>{m.state}</Th>
          <Th>{m.percentage}</Th>
          <Th align="right">{messages.admin.actions}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((f) => row(f, false))}
        {row(draft, true)}
      </tbody>
    </Table>
  )
}
