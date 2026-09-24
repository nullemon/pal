'use client'

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, useToast } from '@palscans/ui'
import { useCallback, useEffect, useState } from 'react'
import {
  EmptyRow,
  Field,
  Hint,
  inputClass,
  Panel,
  PanelHeader,
  Pill,
  selectClass,
  Table,
  Td,
  Th,
  When,
} from '@/components/admin/ui'

/**
 * Issue, list and revoke API keys.
 *
 * The screen is built around the one thing an operator has to understand before pressing the
 * button: a key acts as an account and inherits exactly that account's permissions. That is
 * said next to the picker rather than buried in docs, because it is the whole of the
 * permission model and the only decision being made here.
 *
 * A created token is shown once, in a panel that has to be dismissed deliberately. Nothing
 * stores the plaintext — only its hash — so there is no "show again".
 */
const m = adminMessages.remote

interface KeyRow {
  id: number
  name: string
  prefix: string
  userId: number
  username: string | null
  email: string | null
  role: string | null
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
}

interface Minted {
  token: string
  name: string
  actsAs: { id: number; username: string | null; role: string }
}

interface Props {
  users: Array<{ id: number; username: string | null; email: string; role: string }>
}

const EXPIRY_CHOICES = [0, 30, 90, 365] as const

export function RemoteScreen({ users }: Props) {
  const { toast } = useToast()
  const [keys, setKeys] = useState<KeyRow[]>([])
  const [name, setName] = useState('')
  const [actsAs, setActsAs] = useState<number>(users[0]?.id ?? 0)
  const [expiry, setExpiry] = useState<number>(0)
  const [creating, setCreating] = useState(false)
  const [minted, setMinted] = useState<Minted | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/api-keys')
      const body = await res.json().catch(() => null)
      if (res.ok) setKeys(body?.data?.keys ?? [])
    } catch {
      // A failed list is an empty table, not a broken screen.
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    if (!name.trim() || !actsAs) return
    setCreating(true)
    try {
      const res = await fetch('/api/admin/api-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          userId: actsAs,
          ...(expiry > 0 ? { expiresInDays: expiry } : {}),
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        toast({ title: adminMessages.admin.errorSaving, tone: 'danger' })
        return
      }
      setMinted({ token: body.data.token, name: body.data.name, actsAs: body.data.actsAs })
      setCopied(false)
      setName('')
      await load()
    } finally {
      setCreating(false)
    }
  }

  const revoke = async (id: number) => {
    if (!window.confirm(m.revokeConfirm)) return
    const res = await fetch('/api/admin/api-keys', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) {
      toast({ title: adminMessages.admin.errorSaving, tone: 'danger' })
      return
    }
    toast({ title: m.revoked, tone: 'ok' })
    await load()
  }

  const copy = async () => {
    if (!minted) return
    try {
      await navigator.clipboard.writeText(minted.token)
      setCopied(true)
    } catch {
      // Clipboard refused (insecure context, permission): the token is on screen to select.
    }
  }

  const label = (u: { username: string | null; email: string; role: string }) =>
    `${u.username ?? u.email} · ${u.role}`

  return (
    <div className="flex flex-col gap-3.5">
      {minted ? (
        <Panel className="border-brand">
          <PanelHeader title={m.createdTitle} />
          <p className="mb-2 text-[13px] text-warn">{m.copyNow}</p>
          <code className="block w-full break-all rounded-md border border-line bg-bg p-3 font-mono text-[12px] text-fg">
            {minted.token}
          </code>
          <div className="mt-2 flex items-center gap-2">
            <Button onClick={() => void copy()}>{copied ? m.copied : m.copy}</Button>
            <Button variant="outline" onClick={() => setMinted(null)}>
              {m.done}
            </Button>
            <span className="text-[12px] text-fg-subtle">
              {m.colActsAs}: {minted.actsAs.username ?? minted.actsAs.id} · {minted.actsAs.role}
            </span>
          </div>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader title={m.createTitle} />
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={m.nameLabel} htmlFor="k-name">
            <input
              id="k-name"
              className={inputClass}
              value={name}
              placeholder={m.namePlaceholder}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label={m.actsAsLabel} htmlFor="k-user">
            <select
              id="k-user"
              className={selectClass}
              value={actsAs}
              onChange={(e) => setActsAs(Number(e.target.value))}
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {label(u)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={m.expiryLabel} htmlFor="k-exp">
            <select
              id="k-exp"
              className={selectClass}
              value={expiry}
              onChange={(e) => setExpiry(Number(e.target.value))}
            >
              {EXPIRY_CHOICES.map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? m.expiryNever : fmt(m.expiryDays, { n: d })}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Hint>{m.actsAsNote}</Hint>
        <div className="mt-3">
          <Button onClick={() => void create()} disabled={creating || !name.trim() || !actsAs}>
            {creating ? m.creating : m.create}
          </Button>
        </div>
      </Panel>

      <Panel className="p-0">
        <Table>
          <thead>
            <tr>
              <Th>{m.colName}</Th>
              <Th>{m.colKey}</Th>
              <Th>{m.colActsAs}</Th>
              <Th>{m.colLastUsed}</Th>
              <Th>{m.colExpires}</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? <EmptyRow colSpan={6}>{m.empty}</EmptyRow> : null}
            {keys.map((k) => (
              <tr key={k.id} className={k.revokedAt ? 'opacity-50' : undefined}>
                <Td>{k.name}</Td>
                <Td className="font-mono text-[12px] text-fg-muted">pal_{k.prefix}…</Td>
                <Td>
                  {k.username ?? k.email ?? k.userId}
                  {k.role ? <Pill className="ml-1.5">{k.role}</Pill> : null}
                </Td>
                <Td className="text-fg-muted">
                  {k.lastUsedAt ? <When date={new Date(k.lastUsedAt)} /> : m.never}
                </Td>
                <Td className="text-fg-muted">
                  {k.expiresAt ? <When date={new Date(k.expiresAt)} /> : m.expiryNever}
                </Td>
                <Td className="text-right">
                  {k.revokedAt ? (
                    <Pill tone="danger">{m.revoked}</Pill>
                  ) : (
                    <button
                      type="button"
                      className="text-[13px] text-danger hover:underline"
                      onClick={() => void revoke(k.id)}
                    >
                      {m.revoke}
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <Panel>
        <PanelHeader title={m.howTitle} />
        <p className="mb-2 text-[13px] text-fg-muted">{m.howBody}</p>
        <code className="block w-full break-all rounded-md border border-line bg-bg p-3 font-mono text-[12px] text-fg-muted">
          curl -H &quot;Authorization: Bearer pal_…&quot; https://palscans.org/api/admin/series
        </code>
      </Panel>
    </div>
  )
}
