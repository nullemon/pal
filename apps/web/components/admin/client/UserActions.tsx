'use client'

import { adminMessages } from '@palscans/core/messages/admin'
import { Button, useToast } from '@palscans/ui'
import { useState } from 'react'
import type { UserAction } from '../schemas-users'
import { Field, inputClass, Panel, PanelHeader, Pill, selectClass } from '../ui'
import { postJson } from './api'
import { ConfirmTyped } from './controls'

interface Props {
  user: {
    id: number
    username: string | null
    email: string
    role: string
    commentBannedUntil: string | null
    emailVerifiedAt: string | null
  }
  entitlements: Array<{ feature: string; source: string; expiresAt: string | null }>
  sessions: Array<{
    id: string
    device: { browser: string; os: string } | null
    createdAt: string
    lastSeenAt: string | null
  }>
  bans: Array<{
    id: number
    kind: string
    reason: string | null
    expiresAt: string | null
    createdAt: string
  }>
  subscription: {
    planId: string
    status: string
    currentPeriodEnd: string
    cancelAtPeriodEnd: boolean
  } | null
  perms: { role: boolean; grant: boolean; ban: boolean; update: boolean }
  self: boolean
}

const ROLES = ['user', 'supporter', 'premium', 'uploader', 'moderator', 'admin'] as const
const FEATURES = [
  'early_access',
  'premium_content',
  'offline',
  'no_ads',
  'priority_comments',
  'see_reactors',
  'custom_gifs',
  'animated_avatar',
  'profile_banner',
] as const

export function UserActions({
  user,
  entitlements: initialEnts,
  sessions: initialSessions,
  bans: initialBans,
  subscription,
  perms,
  self,
}: Props) {
  const m = adminMessages.admin.users
  const { toast } = useToast()
  const [role, setRole] = useState(user.role)
  const [pendingRole, setPendingRole] = useState<string | null>(null)
  const [ents, setEnts] = useState(initialEnts)
  const [sessions, setSessions] = useState(initialSessions)
  const [bans, setBans] = useState(initialBans)
  const [commentBan, setCommentBan] = useState(user.commentBannedUntil)
  const [grant, setGrant] = useState<{ feature: (typeof FEATURES)[number]; expiresAt: string }>({
    feature: 'premium_content',
    expiresAt: '',
  })
  const [banReason, setBanReason] = useState('')
  const [cbUntil, setCbUntil] = useState('')
  const now = new Date()
  const banned = bans.some((b) => b.kind === 'user')

  const act = async (action: UserAction): Promise<boolean> => {
    const res = await postJson<{ after: Record<string, unknown> }>(
      `/api/admin/users/${user.id}`,
      action,
    )
    if (!res.ok) {
      toast({
        title: adminMessages.admin.errorSaving,
        description: res.message || res.error,
        tone: 'danger',
      })
      return false
    }
    return true
  }

  return (
    <div className="flex flex-col gap-3.5">
      <ConfirmTyped
        open={pendingRole !== null}
        title={m.changeRole}
        body={m.changeRoleConfirm.replace('{role}', pendingRole ?? '')}
        expected={user.username ?? user.email}
        confirmLabel={m.changeRole}
        tone="brand"
        onClose={() => setPendingRole(null)}
        onConfirm={async () => {
          if (!pendingRole) return
          if (
            await act({
              action: 'role',
              role: pendingRole as (typeof ROLES)[number],
              confirm: user.username ?? user.email,
            })
          ) {
            setRole(pendingRole)
            toast({ title: m.roleChanged, tone: 'ok' })
          }
          setPendingRole(null)
        }}
      />
      <Panel>
        <PanelHeader title={m.role} />
        <div className="flex flex-wrap items-end gap-2">
          <Field label={m.role} className="w-48">
            <select
              className={selectClass}
              value={role}
              disabled={!perms.role || self}
              onChange={(e) => setPendingRole(e.target.value)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          {self ? (
            <span className="pb-2 text-[12px] text-fg-subtle">
              {adminMessages.admin.forbiddenSelf}
            </span>
          ) : null}
          <div className="ml-auto flex gap-2">
            {perms.update && !user.emailVerifiedAt ? (
              <Button
                size="sm"
                variant="outline"
                onClick={async () =>
                  (await act({ action: 'resend_verification' })) &&
                  toast({ title: m.emailSent, tone: 'ok' })
                }
              >
                {m.resendVerification}
              </Button>
            ) : null}
            {perms.update && !self ? (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  if (await act({ action: 'force_logout' })) {
                    setSessions([])
                    toast({ title: m.loggedOut, tone: 'ok' })
                  }
                }}
              >
                {m.forceLogout}
              </Button>
            ) : null}
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title={m.entitlements}
          aside={
            subscription ? (
              <span>
                {m.subscription}: {subscription.planId} · {subscription.status}
              </span>
            ) : (
              <span>{m.noSubscription}</span>
            )
          }
        />
        <ul className="mb-3 flex flex-col gap-1.5 text-[13px]">
          {ents.length === 0 ? <li className="text-fg-muted">{adminMessages.admin.none}</li> : null}
          {ents.map((e) => (
            <li
              key={e.feature}
              className="flex items-center gap-3 rounded-md border border-line bg-bg px-3 py-1.5"
            >
              <span className="font-semibold">{e.feature}</span>
              <Pill>{e.source}</Pill>
              <span className="text-fg-muted">
                {m.expires}:{' '}
                {e.expiresAt ? (
                  <time dateTime={e.expiresAt}>{e.expiresAt.slice(0, 10)}</time>
                ) : (
                  m.permanent
                )}
              </span>
              {perms.grant && !self ? (
                <button
                  type="button"
                  className="ml-auto text-[12px] text-danger"
                  onClick={async () =>
                    (await act({
                      action: 'revoke',
                      feature: e.feature as (typeof FEATURES)[number],
                    })) && setEnts((x) => x.filter((y) => y.feature !== e.feature))
                  }
                >
                  {m.revoke}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {perms.grant && !self ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label={m.feature} className="w-44">
              <select
                className={selectClass}
                value={grant.feature}
                onChange={(e) =>
                  setGrant({ ...grant, feature: e.target.value as (typeof FEATURES)[number] })
                }
              >
                {FEATURES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={m.expires} hint={m.permanent}>
              <input
                type="datetime-local"
                className={inputClass}
                value={grant.expiresAt}
                onChange={(e) => setGrant({ ...grant, expiresAt: e.target.value })}
              />
            </Field>
            <Button
              size="sm"
              className="h-9"
              onClick={async () => {
                const expiresAt = grant.expiresAt ? new Date(grant.expiresAt).toISOString() : null
                if (await act({ action: 'grant', feature: grant.feature, expiresAt }))
                  setEnts((x) => [
                    ...x.filter((y) => y.feature !== grant.feature),
                    { feature: grant.feature, source: 'grant', expiresAt },
                  ])
              }}
            >
              {m.grant}
            </Button>
          </div>
        ) : null}
      </Panel>

      <Panel>
        <PanelHeader title={m.sessions} />
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {sessions.length === 0 ? (
            <li className="text-fg-muted">{adminMessages.admin.none}</li>
          ) : null}
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded-md border border-line bg-bg px-3 py-1.5"
            >
              <span className="font-semibold">
                {s.device ? `${s.device.browser} · ${s.device.os}` : '—'}
              </span>
              <span className="text-[12px] text-fg-muted">
                <time dateTime={s.lastSeenAt ?? s.createdAt}>
                  {(s.lastSeenAt ?? s.createdAt).slice(0, 16).replace('T', ' ')}
                </time>
              </span>
              {perms.update && !self ? (
                <button
                  type="button"
                  className="ml-auto text-[12px] text-danger"
                  onClick={async () =>
                    (await act({ action: 'revoke_session', sessionId: s.id })) &&
                    setSessions((x) => x.filter((y) => y.id !== s.id))
                  }
                >
                  {m.revokeSession}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>

      {perms.ban && !self ? (
        <Panel>
          <PanelHeader title={m.ban} />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Field label={m.commentBanUntil}>
                <input
                  type="datetime-local"
                  className={inputClass}
                  value={cbUntil}
                  onChange={(e) => setCbUntil(e.target.value)}
                />
              </Field>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!cbUntil}
                  onClick={async () => {
                    const until = new Date(cbUntil).toISOString()
                    if (await act({ action: 'comment_ban', until })) setCommentBan(until)
                  }}
                >
                  {m.commentBanUntil}
                </Button>
                {commentBan && new Date(commentBan) > now ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () =>
                      (await act({ action: 'comment_ban', until: null })) && setCommentBan(null)
                    }
                  >
                    {m.liftCommentBan}
                  </Button>
                ) : null}
              </div>
              {commentBan && new Date(commentBan) > now ? (
                <span className="text-[12px] text-warn">
                  {m.commentBanned} → {commentBan.slice(0, 16).replace('T', ' ')}
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              {banned ? (
                <>
                  <ul className="text-[12px] text-danger">
                    {bans.map((b) => (
                      <li key={b.id}>
                        {b.kind} · {b.reason ?? '—'}{' '}
                        {b.expiresAt ? `→ ${b.expiresAt.slice(0, 10)}` : ''}
                      </li>
                    ))}
                  </ul>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => (await act({ action: 'unban' })) && setBans([])}
                  >
                    {m.unban}
                  </Button>
                </>
              ) : (
                <>
                  <Field label={m.banReason}>
                    <input
                      className={inputClass}
                      value={banReason}
                      onChange={(e) => setBanReason(e.target.value)}
                    />
                  </Field>
                  <div>
                    <Button
                      size="sm"
                      className="bg-danger text-white hover:bg-danger/90"
                      onClick={async () => {
                        if (
                          await act({
                            action: 'ban',
                            reason: banReason || undefined,
                            expiresAt: null,
                          })
                        )
                          setBans((b) => [
                            ...b,
                            {
                              id: Date.now(),
                              kind: 'user',
                              reason: banReason || null,
                              expiresAt: null,
                              createdAt: now.toISOString(),
                            },
                          ])
                      }}
                    >
                      {m.ban}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  )
}
