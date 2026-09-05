/** biome-ignore-all lint/a11y/useSemanticElements: the matrix cell is a button carrying checkbox semantics, so a locked cell can answer a click with its reason instead of ignoring it */
'use client'

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
// `@palscans/core/permissions`, not the package root: the barrel reaches the storage and
// queue drivers, which drag `child_process` and the S3 client into the browser bundle.
import {
  grants,
  isDefaultPermission,
  isLockedPermission,
  type Permission,
  type PermissionOverrides,
  permissionChanges,
  ROLES,
  type Role,
} from '@palscans/core/permissions'
import { Button, cn, useToast } from '@palscans/ui'
import { Check, Lock, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '@/components/admin/client/api'
import { SaveBar } from '@/components/admin/client/controls'
import {
  PERMISSION_GROUP_KEYS,
  PERMISSION_GROUPS,
  type PermissionGroupKey,
} from '@/components/admin/permission-groups'
import { Panel, PanelHeader, Table, Td, Th } from '@/components/admin/ui'

/**
 * The matrix. One row per permission, one column per role, and three states a cell can be in
 * — granted, denied, and fixed — none of which is signalled by colour alone: a granted cell
 * carries a tick, a fixed one a padlock and an `aria-disabled` checkbox, and a cell that has
 * been moved off its compiled default is marked "changed" in text next to it.
 *
 * The two fixed cells (`admin.access` and `settings.write` on `admin`) are rendered as
 * disabled controls that still answer a click: pressing one raises the reason rather than
 * doing nothing, because a control that ignores you is indistinguishable from one that is
 * broken.
 */

const m = adminMessages.roles

export function RolesMatrix({ initial }: { initial: PermissionOverrides }) {
  const { toast } = useToast()
  const [saved, setSaved] = useState<PermissionOverrides>(initial)
  const [draft, setDraft] = useState<PermissionOverrides>(initial)
  const [busy, setBusy] = useState(false)

  const changes = useMemo(() => permissionChanges(saved, draft), [saved, draft])
  const dirty = changes.length > 0
  const offDefault = useMemo(() => permissionChanges({}, draft).length, [draft])

  const set = (role: Role, permission: Permission, value: boolean) => {
    if (isLockedPermission(role, permission)) {
      toast({
        title: m.lockedTitle,
        description: fmt(m.lockedBody, { permission, role: m.roleNames[role] }),
        tone: 'danger',
      })
      return
    }
    setDraft((d) => {
      const row = { ...(d[role] ?? {}) }
      if (value === isDefaultPermission(role, permission)) delete row[permission]
      else row[permission] = value
      const next: PermissionOverrides = { ...d }
      if (Object.keys(row).length === 0) delete next[role]
      else next[role] = row
      return next
    })
    // Handing a role the ability to edit this matrix is the one grant that is different in
    // kind from the others, so it is called out at the moment it is made.
    if (value && permission === 'settings.write' && role !== 'admin')
      toast({
        title: m.escalationTitle,
        description: fmt(m.escalationWarning, { permission, role: m.roleNames[role] }),
        tone: 'danger',
      })
  }

  const resetRole = (role: Role) =>
    setDraft((d) => {
      const next = { ...d }
      delete next[role]
      return next
    })

  const save = async () => {
    setBusy(true)
    const res = await api<{ overrides: PermissionOverrides; changes: unknown[] }>(
      '/api/admin/access/roles',
      { method: 'PUT', body: JSON.stringify(draft) },
    )
    setBusy(false)
    if (!res.ok) {
      toast({ title: m.saveFailed, description: res.message || res.error, tone: 'danger' })
      return
    }
    const n = res.data.changes.length
    setSaved(res.data.overrides)
    setDraft(res.data.overrides)
    toast({
      title: m.saved,
      description: fmt(n === 1 ? m.savedDetail : m.savedDetailPlural, { n }),
      tone: 'ok',
    })
  }

  return (
    <div className="flex flex-col gap-3.5">
      <SaveBar
        dirty={dirty}
        saving={busy}
        onSave={() => void save()}
        onDiscard={() => setDraft(saved)}
        status={
          offDefault === 0 ? (
            m.noChanges
          ) : (
            <span className="tabular-nums">
              {fmt(offDefault === 1 ? m.changeCount : m.changeCountPlural, { n: offDefault })}
            </span>
          )
        }
      />

      <Panel>
        <PanelHeader title={m.legendTitle} />
        <ul className="grid gap-1.5 text-[13px] leading-[18px] text-fg-muted sm:grid-cols-2">
          <li className="flex items-center gap-2">
            <span className="inline-flex size-[18px] items-center justify-center rounded-[5px] border border-brand bg-brand text-brand-ink">
              <Check size={12} aria-hidden="true" />
            </span>
            {m.legendGranted}
          </li>
          <li className="flex items-center gap-2">
            <span className="inline-flex size-[18px] items-center justify-center rounded-[5px] border border-fg-muted/80 bg-bg" />
            {m.legendDefault}
          </li>
          <li className="flex items-center gap-2">
            <span className="rounded-full bg-gold/15 px-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-gold">
              {m.changedShort}
            </span>
            {m.legendChanged}
          </li>
          <li className="flex items-center gap-2">
            <Lock size={14} aria-hidden="true" className="text-fg-subtle" />
            {m.legendLocked}
          </li>
        </ul>
      </Panel>

      <Table>
        <thead>
          <tr>
            <Th className="min-w-[280px]">{m.colPermission}</Th>
            {ROLES.map((role) => (
              <Th key={role} align="center" className="min-w-[104px]">
                <span className="block">{m.roleNames[role]}</span>
                <span className="block font-mono text-[10px] font-normal normal-case tracking-normal text-fg-subtle">
                  {role}
                </span>
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSION_GROUP_KEYS.map((group) => (
            <GroupRows key={group} group={group} draft={draft} onSet={set} />
          ))}
          <tr>
            <Td className="text-[12px] text-fg-subtle">{m.resetAll}</Td>
            {ROLES.map((role) => (
              <Td key={role} align="center">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[12px]"
                  disabled={!draft[role]}
                  aria-label={fmt(m.resetRole, { role: m.roleNames[role] })}
                  onClick={() => resetRole(role)}
                >
                  {m.resetLabel}
                </Button>
              </Td>
            ))}
          </tr>
        </tbody>
      </Table>
    </div>
  )
}

function GroupRows({
  group,
  draft,
  onSet,
}: {
  group: PermissionGroupKey
  draft: PermissionOverrides
  onSet: (role: Role, permission: Permission, value: boolean) => void
}) {
  return (
    <>
      <tr>
        <th
          colSpan={ROLES.length + 1}
          scope="colgroup"
          className="h-8 border-b border-line bg-surface-2 px-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted"
        >
          {m.groups[group]}
        </th>
      </tr>
      {PERMISSION_GROUPS[group].map((permission) => (
        <tr key={permission}>
          <Td className="align-top">
            <div className="py-1.5">
              <code className="text-[12px] font-semibold">{permission}</code>
              <p className="mt-0.5 max-w-[46ch] text-[12.5px] leading-[17px] text-fg-muted">
                {m.permissions[permission]}
              </p>
            </div>
          </Td>
          {ROLES.map((role) => (
            <Cell key={role} role={role} permission={permission} draft={draft} onSet={onSet} />
          ))}
        </tr>
      ))}
    </>
  )
}

function Cell({
  role,
  permission,
  draft,
  onSet,
}: {
  role: Role
  permission: Permission
  draft: PermissionOverrides
  onSet: (role: Role, permission: Permission, value: boolean) => void
}) {
  const locked = isLockedPermission(role, permission)
  const value = grants(role, permission, draft)
  const def = isDefaultPermission(role, permission)
  const changed = !locked && value !== def
  const label = `${m.roleNames[role]} · ${permission} · ${value ? m.granted : m.denied}${
    locked ? ` · ${m.lockedLabel}` : ''
  }`
  return (
    <Td align="center" className="align-top">
      <div className="flex flex-col items-center gap-1 py-1.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={value}
          aria-disabled={locked}
          aria-label={label}
          title={locked ? fmt(m.lockedBody, { permission, role: m.roleNames[role] }) : label}
          onClick={() => onSet(role, permission, !value)}
          className={cn(
            'inline-flex size-[22px] items-center justify-center rounded-[6px] border transition-colors',
            // `border-line` is 1.25:1 against the table surface — invisible as a UI
            // component. The state is also written under every cell, but the grid is read by
            // scanning the ticks, so the empty box has to be a shape you can actually see.
            value
              ? 'border-brand bg-brand text-brand-ink'
              : 'border-fg-muted/80 bg-bg text-transparent',
            locked ? 'cursor-not-allowed opacity-80' : 'hover:border-brand',
          )}
        >
          {locked ? (
            <Lock size={12} aria-hidden="true" className="text-brand-ink" />
          ) : (
            <Check size={13} aria-hidden="true" />
          )}
        </button>
        {locked ? (
          <span className="text-[10px] font-bold uppercase leading-none tracking-[0.06em] text-fg-subtle">
            {m.lockedLabel}
          </span>
        ) : changed ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-1.5 py-px text-[10px] font-bold uppercase leading-none tracking-[0.06em] text-gold">
            <TriangleAlert size={9} aria-hidden="true" />
            {m.changedShort}
          </span>
        ) : (
          <span className="text-[10px] leading-none text-fg-subtle">
            {value ? m.granted : m.denied}
          </span>
        )}
      </div>
    </Td>
  )
}
