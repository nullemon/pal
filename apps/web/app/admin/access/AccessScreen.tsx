'use client'

import { messages } from '@palscans/core/messages'
import { Button, useToast } from '@palscans/ui'
import { Copy } from 'lucide-react'
import { useState } from 'react'
import { api, postJson, putJson } from '@/components/admin/client/api'
import { SaveBar, Segmented, Toggle } from '@/components/admin/client/controls'
import {
  EmptyRow,
  Field,
  Hint,
  inputClass,
  Panel,
  PanelHeader,
  Pill,
  type PillTone,
  selectClass,
  Table,
  Td,
  Th,
  textareaClass,
} from '@/components/admin/ui'
import type { AccessSetting, DomainMode, InviteState, RegistrationMode } from '@/lib/auth/invites'

export interface AccessFormState {
  registration: RegistrationMode
  access: AccessSetting
  minAccountAgeMinutes: number
}

export interface InviteView {
  id: number
  code: string
  maxUses: number
  uses: number
  note: string | null
  expiresAt: string | null
  createdAt: string
  revokedAt: string | null
  state: InviteState
}

const stateTone: Record<InviteState, PillTone> = {
  active: 'ok',
  revoked: 'danger',
  expired: 'warn',
  used: 'neutral',
}

const localToIso = (value: string): string | null => (value ? new Date(value).toISOString() : null)

export function AccessScreen({
  initial,
  invites: initialInvites,
  turnstileConfigured,
}: {
  initial: AccessFormState
  invites: InviteView[]
  turnstileConfigured: boolean
}) {
  const m = messages.admin.access
  const { toast } = useToast()
  const [saved, setSaved] = useState(initial)
  const [s, setS] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [domainText, setDomainText] = useState(initial.access.domains.join('\n'))
  const [invites, setInvites] = useState(initialInvites)
  const [draft, setDraft] = useState({ maxUses: 1, expiresAt: '', note: '' })
  const [creating, setCreating] = useState(false)

  const setAccess = (patch: Partial<AccessSetting>) =>
    setS({ ...s, access: { ...s.access, ...patch } })
  const dirty = JSON.stringify(s) !== JSON.stringify(saved)

  const save = async () => {
    setSaving(true)
    const payload = {
      registration: s.registration,
      access: {
        ...s.access,
        domains: domainText
          .split(/[\n,]/)
          .map((d) => d.trim())
          .filter(Boolean),
      },
      minAccountAgeMinutes: s.minAccountAgeMinutes,
    }
    const res = await putJson<AccessFormState>('/api/admin/access', payload)
    setSaving(false)
    if (!res.ok)
      return toast({ title: messages.admin.errorSaving, description: res.message, tone: 'danger' })
    const next: AccessFormState = {
      registration: res.data.registration,
      access: res.data.access,
      minAccountAgeMinutes: res.data.minAccountAgeMinutes,
    }
    setSaved(next)
    setS(next)
    setDomainText(next.access.domains.join('\n'))
    toast({ title: m.saved, tone: 'ok' })
  }

  return (
    <div className="flex flex-col gap-3.5">
      <SaveBar
        dirty={dirty}
        saving={saving}
        onDiscard={() => {
          setS(saved)
          setDomainText(saved.access.domains.join('\n'))
        }}
        onSave={() => void save()}
      />

      <div className="grid items-start gap-3.5 lg:grid-cols-2">
        <Panel>
          <PanelHeader title={m.registration} hint={m.registrationHint} />
          <Segmented
            value={s.registration}
            ariaLabel={m.registration}
            onChange={(v) => setS({ ...s, registration: v })}
            options={[
              { value: 'open' as const, label: m.registrationModes.open },
              { value: 'invite' as const, label: m.registrationModes.invite },
              { value: 'closed' as const, label: m.registrationModes.closed },
            ]}
          />
        </Panel>

        <Panel>
          <PanelHeader title={m.checks} />
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-semibold">{m.requireVerification}</span>
                <Hint>{m.requireVerificationHint}</Hint>
              </div>
              <Toggle
                checked={s.access.require_verification}
                ariaLabel={m.requireVerification}
                onChange={(v) => setAccess({ require_verification: v })}
              />
            </div>
            <div className="flex items-start justify-between gap-4 border-t border-line-soft pt-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-semibold">{m.turnstile}</span>
                <Hint>{m.turnstileHint}</Hint>
                <Hint className={turnstileConfigured ? 'text-ok' : 'text-warn'}>
                  {turnstileConfigured ? m.turnstileConfigured : m.turnstileMissing}
                </Hint>
              </div>
              <Toggle
                checked={s.access.turnstile && turnstileConfigured}
                disabled={!turnstileConfigured}
                ariaLabel={m.turnstile}
                onChange={(v) => setAccess({ turnstile: v })}
              />
            </div>
            <Field
              label={m.minAccountAge}
              hint={m.minAccountAgeHint}
              htmlFor="ac-age"
              className="border-t border-line-soft pt-4"
            >
              <input
                id="ac-age"
                type="number"
                min={0}
                max={43200}
                className={`${inputClass} max-w-32`}
                value={s.minAccountAgeMinutes}
                onChange={(e) =>
                  setS({ ...s, minAccountAgeMinutes: Math.max(0, Number(e.target.value) || 0) })
                }
              />
            </Field>
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title={m.domains} hint={m.domainsHint} />
        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
          <Field label={m.domainMode} htmlFor="ac-mode">
            <select
              id="ac-mode"
              className={selectClass}
              value={s.access.domain_mode}
              onChange={(e) => setAccess({ domain_mode: e.target.value as DomainMode })}
            >
              <option value="off">{m.domainModes.off}</option>
              <option value="allow">{m.domainModes.allow}</option>
              <option value="block">{m.domainModes.block}</option>
            </select>
            {s.access.domain_mode !== 'off' && domainText.trim() === '' ? (
              <Hint className="text-warn">{m.domainsEmpty}</Hint>
            ) : null}
          </Field>
          <Field label={m.domains} htmlFor="ac-domains">
            <textarea
              id="ac-domains"
              rows={5}
              spellCheck={false}
              placeholder={m.domainsPlaceholder}
              className={textareaClass}
              value={domainText}
              onChange={(e) => {
                setDomainText(e.target.value)
                setAccess({
                  domains: e.target.value
                    .split(/[\n,]/)
                    .map((d) => d.trim())
                    .filter(Boolean),
                })
              }}
            />
          </Field>
        </div>
      </Panel>

      <Panel className="p-0 md:px-0">
        <div className="px-5 pt-4">
          <PanelHeader
            title={m.invites}
            hint={m.invitesHint}
            aside={s.registration === 'invite' ? null : <span>{m.invitesInactive}</span>}
          />
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <Field label={m.maxUses} htmlFor="ac-uses" className="w-24">
              <input
                id="ac-uses"
                type="number"
                min={1}
                max={1000}
                className={inputClass}
                value={draft.maxUses}
                onChange={(e) =>
                  setDraft({ ...draft, maxUses: Math.max(1, Number(e.target.value) || 1) })
                }
              />
            </Field>
            <Field label={m.expires} hint={m.never} htmlFor="ac-exp">
              <input
                id="ac-exp"
                type="datetime-local"
                className={inputClass}
                value={draft.expiresAt}
                onChange={(e) => setDraft({ ...draft, expiresAt: e.target.value })}
              />
            </Field>
            <Field label={m.note} htmlFor="ac-note" className="min-w-56 flex-1">
              <input
                id="ac-note"
                className={inputClass}
                placeholder={m.notePlaceholder}
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </Field>
            <Button
              size="sm"
              className="h-9"
              disabled={creating}
              onClick={async () => {
                setCreating(true)
                const res = await postJson<{ invite: InviteView }>('/api/admin/access/invites', {
                  maxUses: draft.maxUses,
                  expiresAt: localToIso(draft.expiresAt),
                  note: draft.note.trim() || null,
                })
                setCreating(false)
                if (!res.ok)
                  return toast({
                    title: messages.admin.errorSaving,
                    description: res.message,
                    tone: 'danger',
                  })
                setInvites((rows) => [{ ...res.data.invite, state: 'active' }, ...rows])
                setDraft({ maxUses: 1, expiresAt: '', note: '' })
                toast({ title: m.created, description: res.data.invite.code, tone: 'ok' })
              }}
            >
              {m.generate}
            </Button>
          </div>
        </div>
        <Table className="rounded-none border-0 border-t">
          <thead>
            <tr>
              <Th>{m.colCode}</Th>
              <Th>{m.colState}</Th>
              <Th align="right">{m.colUses}</Th>
              <Th>{m.colNote}</Th>
              <Th align="right">{m.colExpires}</Th>
              <Th align="right">{m.colCreated}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {invites.length === 0 ? <EmptyRow colSpan={7}>{m.noInvites}</EmptyRow> : null}
            {invites.map((i) => (
              <tr key={i.id}>
                <Td>
                  <span className="flex items-center gap-2">
                    <code className="rounded-sm bg-surface-3 px-1.5 py-0.5 font-semibold tracking-[0.08em]">
                      {i.code}
                    </code>
                    <button
                      type="button"
                      aria-label={m.copy}
                      className="text-fg-subtle hover:text-fg"
                      onClick={() => {
                        void navigator.clipboard
                          ?.writeText(i.code)
                          .then(() => toast({ title: m.copied, tone: 'ok' }))
                      }}
                    >
                      <Copy size={13} aria-hidden="true" />
                    </button>
                  </span>
                </Td>
                <Td>
                  <Pill tone={stateTone[i.state]}>{m.states[i.state]}</Pill>
                </Td>
                <Td align="right" className="tabular-nums">
                  {i.uses}/{i.maxUses}
                </Td>
                <Td className="max-w-[220px] truncate text-fg-muted">{i.note ?? '—'}</Td>
                <Td align="right" className="text-fg-muted">
                  {i.expiresAt ? (
                    <time dateTime={i.expiresAt}>{i.expiresAt.slice(0, 10)}</time>
                  ) : (
                    m.never
                  )}
                </Td>
                <Td align="right" className="text-fg-muted">
                  <time dateTime={i.createdAt}>{i.createdAt.slice(0, 10)}</time>
                </Td>
                <Td align="right">
                  {i.state === 'active' ? (
                    <button
                      type="button"
                      className="text-[12px] text-danger"
                      onClick={async () => {
                        const res = await api<{ id: number }>(`/api/admin/access/invites/${i.id}`, {
                          method: 'DELETE',
                        })
                        if (!res.ok)
                          return toast({
                            title: messages.admin.errorSaving,
                            description: res.message,
                            tone: 'danger',
                          })
                        setInvites((rows) =>
                          rows.map((r) => (r.id === i.id ? { ...r, state: 'revoked' } : r)),
                        )
                        toast({ title: m.revoked, tone: 'ok' })
                      }}
                    >
                      {m.revoke}
                    </button>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </div>
  )
}
