'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Button, useToast } from '@palscans/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { z } from 'zod'
import {
  BULK_CONFIRM_WORD,
  type BulkUsersInput,
  ROLE_VALUES,
  type userRoleSchema,
} from '@/app/admin/users/schemas'
import { postJson } from '@/components/admin/client/api'
import { ConfirmTyped } from '@/components/admin/client/controls'
import {
  EmptyRow,
  Pill,
  type PillTone,
  selectClass,
  Table,
  Td,
  Th,
  When,
} from '@/components/admin/ui'

type Role = z.infer<typeof userRoleSchema>

export interface UserRowView {
  id: number
  email: string
  username: string | null
  role: Role
  createdAt: string
  lastLoginAt: string | null
  emailVerifiedAt: string | null
  commentBannedUntil: string | null
  banned: boolean
}

export interface UsersTablePerms {
  role: boolean
  ban: boolean
  update: boolean
}

const roleTone = (role: string): PillTone =>
  role === 'admin' ? 'brand' : role === 'moderator' || role === 'uploader' ? 'gold' : 'neutral'

/**
 * The users list with selection and the bulk bar (docs/17 §C). Selection is per page and
 * lives in the URL-free client state; every bulk action asks for the same typed confirmation
 * the single-user role change does, and the server re-checks self / staff / permission per row.
 */
export function UsersTable({
  rows,
  perms,
  actorId,
  query,
}: {
  rows: UserRowView[]
  perms: UsersTablePerms
  actorId: number
  query: string
}) {
  const m = messages.admin.users
  const router = useRouter()
  const { toast } = useToast()
  const [selected, setSelected] = useState<number[]>([])
  const [role, setRole] = useState<Role>('user')
  const [pending, setPending] = useState<BulkUsersInput['action'] | null>(null)
  const [busy, setBusy] = useState(false)
  const now = new Date()

  const selectable = rows.filter((r) => r.id !== actorId)
  const allSelected = selectable.length > 0 && selected.length === selectable.length
  const toggle = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const run = async (action: BulkUsersInput['action']): Promise<void> => {
    setBusy(true)
    const res = await postJson<{ updated: number; skipped: number }>('/api/admin/users/bulk', {
      ids: selected,
      confirm: BULK_CONFIRM_WORD,
      action,
    })
    setBusy(false)
    setPending(null)
    if (!res.ok) {
      toast({ title: messages.admin.errorSaving, description: res.message, tone: 'danger' })
      return
    }
    toast({
      title: fmt(m.bulkDone, { n: res.data.updated }),
      description: res.data.skipped ? fmt(m.bulkSkipped, { n: res.data.skipped }) : undefined,
      tone: 'ok',
    })
    setSelected([])
    router.refresh()
  }

  const exportCsv = () => {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (selected.length) params.set('ids', selected.join(','))
    window.location.href = `/api/admin/users/export?${params.toString()}`
  }

  const actionLabel =
    pending?.kind === 'role'
      ? `${m.bulkRole}: ${pending.role}`
      : pending?.kind === 'ban'
        ? m.bulkBan
        : pending?.kind === 'unban'
          ? m.bulkUnban
          : pending?.kind === 'comment_ban'
            ? m.bulkCommentBan
            : m.bulkForceLogout

  return (
    <>
      <ConfirmTyped
        open={pending !== null}
        title={actionLabel}
        body={fmt(m.bulkConfirm, {
          value: BULK_CONFIRM_WORD,
          action: actionLabel,
          n: selected.length,
        })}
        expected={BULK_CONFIRM_WORD}
        confirmLabel={m.bulkApply}
        tone={pending?.kind === 'force_logout' ? 'brand' : 'danger'}
        onClose={() => setPending(null)}
        onConfirm={() => (pending ? run(pending) : undefined)}
      />

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-1 px-3 py-2">
        <span className="text-[13px] font-semibold">
          {selected.length > 0 ? fmt(m.selected, { n: selected.length }) : m.selectAll}
        </span>
        {selected.length > 0 ? (
          <button
            type="button"
            className="text-[12px] text-fg-subtle hover:text-fg"
            onClick={() => setSelected([])}
          >
            {m.clearSelection}
          </button>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {perms.role ? (
            <>
              <span className="block w-36">
                <select
                  aria-label={m.bulkRole}
                  className={`${selectClass} h-8`}
                  value={role}
                  disabled={selected.length === 0 || busy}
                  onChange={(e) => setRole(e.target.value as Role)}
                >
                  {ROLE_VALUES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={selected.length === 0 || busy}
                onClick={() => setPending({ kind: 'role', role })}
              >
                {m.bulkRole}
              </Button>
            </>
          ) : null}
          {perms.ban ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={selected.length === 0 || busy}
                onClick={() => setPending({ kind: 'comment_ban', days: 7 })}
              >
                {m.bulkCommentBan}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={selected.length === 0 || busy}
                onClick={() => setPending({ kind: 'unban' })}
              >
                {m.bulkUnban}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-danger"
                disabled={selected.length === 0 || busy}
                onClick={() => setPending({ kind: 'ban' })}
              >
                {m.bulkBan}
              </Button>
            </>
          ) : null}
          {perms.update ? (
            <Button
              size="sm"
              variant="outline"
              disabled={selected.length === 0 || busy}
              onClick={() => setPending({ kind: 'force_logout' })}
            >
              {m.bulkForceLogout}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={exportCsv}>
            {m.bulkExport}
          </Button>
        </div>
      </div>

      <Table>
        <thead>
          <tr>
            <Th className="w-9">
              <input
                type="checkbox"
                aria-label={m.selectAll}
                className="size-3.5 accent-[var(--color-brand)]"
                checked={allSelected}
                onChange={(e) => setSelected(e.target.checked ? selectable.map((r) => r.id) : [])}
              />
            </Th>
            <Th>{m.colUser}</Th>
            <Th>{m.colRole}</Th>
            <Th>{m.colStatus}</Th>
            <Th align="right">{m.colJoined}</Th>
            <Th align="right">{m.colLastLogin}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={6}>{m.empty}</EmptyRow> : null}
          {rows.map((u) => (
            <tr key={u.id} className="hover:bg-surface-2/60">
              <Td>
                <input
                  type="checkbox"
                  aria-label={fmt(m.selectRow, { user: u.username ?? u.email })}
                  className="size-3.5 accent-[var(--color-brand)]"
                  disabled={u.id === actorId}
                  checked={selected.includes(u.id)}
                  onChange={() => toggle(u.id)}
                />
              </Td>
              <Td>
                <a href={`/admin/users/${u.id}`} className="block">
                  <span className="block font-semibold hover:text-brand-hover">
                    {u.username ?? `#${u.id}`}
                  </span>
                  <span className="block text-[12px] text-fg-subtle">{u.email}</span>
                </a>
              </Td>
              <Td>
                <Pill tone={roleTone(u.role)}>{u.role}</Pill>
              </Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {u.banned ? <Pill tone="danger">{m.banned}</Pill> : null}
                  {u.commentBannedUntil && new Date(u.commentBannedUntil) > now ? (
                    <Pill tone="warn">{m.commentBanned}</Pill>
                  ) : null}
                  {!u.emailVerifiedAt ? <Pill>{m.unverified}</Pill> : null}
                </div>
              </Td>
              <Td align="right" className="text-fg-muted">
                <When date={new Date(u.createdAt)} />
              </Td>
              <Td align="right" className="text-fg-muted">
                <When date={u.lastLoginAt ? new Date(u.lastLoginAt) : null} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  )
}
