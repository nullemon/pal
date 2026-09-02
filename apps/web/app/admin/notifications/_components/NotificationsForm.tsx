'use client'

import { messages } from '@palscans/core/messages'
import { Button, useToast } from '@palscans/ui'
import { Plus, RefreshCw, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { postJson, putJson } from '@/components/admin/client/api'
import { SaveBar, Toggle } from '@/components/admin/client/controls'
import {
  Field,
  Hint,
  inputClass,
  Panel,
  PanelHeader,
  Pill,
  selectClass,
} from '@/components/admin/ui'
import { DISCORD_EVENTS, type NotificationSettings } from '@/lib/notifications/schema'

/**
 * `Admin → Community → Notifications` — the operator's controls (docs/17 §D).
 *
 * Every panel states plainly whether its channel *can* run: the environment decides that, and
 * a channel whose keys are missing is shown with its switch disabled and the variable names
 * spelled out, rather than a control that silently does nothing.
 */
export interface ChannelAvailability {
  push: { configured: boolean; missing: readonly string[] }
  discord: { configured: boolean; missing: readonly string[] }
  roleSync: { configured: boolean; missing: readonly string[] }
  mailer: string
}

export interface PlanOption {
  id: string
  name: string
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const newId = () => `wh_${Math.random().toString(36).slice(2, 10)}`

function Unavailable({ missing }: { missing: readonly string[] }) {
  const m = messages.notify
  return (
    <div className="rounded-md border border-line bg-surface-2 p-3 text-[13px] text-fg-muted">
      <span className="font-semibold text-fg">{m.notConfigured}</span>
      {missing.length ? (
        <p className="mt-0.5">{m.notConfiguredHint.replace('{keys}', missing.join(', '))}</p>
      ) : null}
    </div>
  )
}

export function NotificationsForm({
  initial,
  availability,
  plans,
  counts,
}: {
  initial: NotificationSettings
  availability: ChannelAvailability
  plans: readonly PlanOption[]
  counts: { devices: number; digest: number; linked: number }
}) {
  const m = messages.notify.admin
  const { toast } = useToast()
  const [saved, setSaved] = useState(initial)
  const [s, setS] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const dirty = JSON.stringify(s) !== JSON.stringify(saved)

  const save = async () => {
    setSaving(true)
    const res = await putJson<NotificationSettings>('/api/admin/notifications', s)
    setSaving(false)
    if (!res.ok)
      return toast({ title: messages.admin.errorSaving, description: res.message, tone: 'danger' })
    setSaved(res.data)
    setS(res.data)
    toast({ title: m.saved, tone: 'ok' })
  }

  const runTest = async (body: Record<string, unknown>, key: string) => {
    setBusy(key)
    const res = await postJson<{ message?: string }>('/api/admin/notifications/test', body)
    setBusy(null)
    toast({
      title: res.ok ? (res.data.message ?? m.testSent) : res.message || m.testFailed,
      tone: res.ok ? 'ok' : 'danger',
    })
  }

  const syncRoles = async () => {
    setBusy('roles')
    const res = await postJson<{ message?: string }>('/api/admin/notifications/roles', {})
    setBusy(null)
    toast({
      title: res.ok ? (res.data.message ?? '') : res.message,
      tone: res.ok ? 'ok' : 'danger',
    })
  }

  return (
    <div className="flex flex-col gap-3.5">
      <SaveBar
        dirty={dirty}
        saving={saving}
        onDiscard={() => setS(saved)}
        onSave={() => void save()}
      />

      <Panel>
        <PanelHeader
          title={m.pushPanel}
          hint={m.pushHint}
          aside={
            <>
              <Pill tone={availability.push.configured ? 'ok' : 'warn'}>
                {availability.push.configured ? messages.admin.on : messages.notify.notConfigured}
              </Pill>
              <span>
                {m.subscriptions}: {counts.devices}
              </span>
            </>
          }
        />
        {availability.push.configured ? null : <Unavailable missing={availability.push.missing} />}
        <div className="mt-3 flex flex-wrap items-end gap-5">
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-fg-muted">{messages.admin.enabled}</span>
            <Toggle
              checked={s.push.enabled}
              ariaLabel={m.pushPanel}
              disabled={!availability.push.configured}
              onChange={(v) => setS({ ...s, push: { ...s.push, enabled: v } })}
            />
          </div>
          <Field label={m.pushTtl} hint={m.pushTtlHint} htmlFor="push-ttl" className="w-44">
            <input
              id="push-ttl"
              type="number"
              min={60}
              max={2419200}
              className={inputClass}
              value={s.push.ttlSeconds}
              onChange={(e) =>
                setS({ ...s, push: { ...s.push, ttlSeconds: Number(e.target.value) || 60 } })
              }
            />
          </Field>
          <Button
            size="sm"
            variant="outline"
            disabled={!availability.push.configured || busy !== null}
            onClick={() => void runTest({ channel: 'push' }, 'push')}
          >
            <Send size={13} aria-hidden="true" />
            {m.sendTestPush}
          </Button>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title={m.emailPanel}
          hint={m.emailHint}
          aside={
            <>
              <Pill tone={availability.mailer === 'none' ? 'warn' : 'ok'}>
                {availability.mailer}
              </Pill>
              <span>
                {m.optedIn}: {counts.digest}
              </span>
            </>
          }
        />
        <div className="flex flex-wrap items-end gap-5">
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-fg-muted">{messages.admin.enabled}</span>
            <Toggle
              checked={s.email.enabled}
              ariaLabel={m.emailPanel}
              onChange={(v) => setS({ ...s, email: { ...s.email, enabled: v } })}
            />
          </div>
          <Field label={m.emailHour} htmlFor="email-hour" className="w-28">
            <input
              id="email-hour"
              type="number"
              min={0}
              max={23}
              className={inputClass}
              value={s.email.hourUtc}
              onChange={(e) =>
                setS({
                  ...s,
                  email: { ...s.email, hourUtc: Math.min(23, Math.max(0, Number(e.target.value))) },
                })
              }
            />
          </Field>
          <Field label={m.emailWeekday} htmlFor="email-day" className="w-40">
            <select
              id="email-day"
              className={selectClass}
              value={s.email.weeklyDay}
              onChange={(e) =>
                setS({ ...s, email: { ...s.email, weeklyDay: Number(e.target.value) } })
              }
            >
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
          <Field label={m.emailMaxItems} htmlFor="email-max" className="w-28">
            <input
              id="email-max"
              type="number"
              min={1}
              max={50}
              className={inputClass}
              value={s.email.maxItems}
              onChange={(e) =>
                setS({
                  ...s,
                  email: {
                    ...s.email,
                    maxItems: Math.min(50, Math.max(1, Number(e.target.value))),
                  },
                })
              }
            />
          </Field>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void runTest({ channel: 'email' }, 'email')}
          >
            <Send size={13} aria-hidden="true" />
            {m.sendTestDigest}
          </Button>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title={m.discordPanel}
          hint={m.discordHint}
          aside={
            <>
              <Pill tone={availability.discord.configured ? 'ok' : 'warn'}>
                {availability.discord.configured
                  ? messages.admin.on
                  : messages.notify.notConfigured}
              </Pill>
              <span>
                {m.linkedAccounts}: {counts.linked}
              </span>
            </>
          }
        />
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-fg-muted">
                {messages.admin.enabled}
              </span>
              <Toggle
                checked={s.discord.enabled}
                ariaLabel={m.discordPanel}
                onChange={(v) => setS({ ...s, discord: { ...s.discord, enabled: v } })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-fg-muted">{m.dms}</span>
              <Toggle
                checked={s.discord.dms}
                ariaLabel={m.dms}
                disabled={!availability.discord.configured}
                onChange={(v) => setS({ ...s, discord: { ...s.discord, dms: v } })}
              />
            </div>
            <Hint className="max-w-[46ch]">{m.dmsHint}</Hint>
          </div>

          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-fg">{m.webhooks}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setS({
                    ...s,
                    discord: {
                      ...s.discord,
                      webhooks: [
                        ...s.discord.webhooks,
                        {
                          id: newId(),
                          name: '',
                          url: '',
                          events: ['new_chapter'],
                          enabled: true,
                        },
                      ],
                    },
                  })
                }
              >
                <Plus size={13} aria-hidden="true" />
                {m.addWebhook}
              </Button>
            </div>
            {s.discord.webhooks.length === 0 ? (
              <Hint>{messages.admin.noResults}</Hint>
            ) : (
              s.discord.webhooks.map((hook, i) => (
                <div
                  key={hook.id}
                  className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-bg p-3"
                >
                  <Field label={m.webhookName} htmlFor={`wh-name-${hook.id}`} className="w-44">
                    <input
                      id={`wh-name-${hook.id}`}
                      className={inputClass}
                      value={hook.name}
                      onChange={(e) => {
                        const webhooks = [...s.discord.webhooks]
                        webhooks[i] = { ...hook, name: e.target.value }
                        setS({ ...s, discord: { ...s.discord, webhooks } })
                      }}
                    />
                  </Field>
                  <Field
                    label={m.webhookUrl}
                    htmlFor={`wh-url-${hook.id}`}
                    className="min-w-[260px] flex-1"
                  >
                    <input
                      id={`wh-url-${hook.id}`}
                      className={`${inputClass} font-mono text-[12px]`}
                      placeholder="https://discord.com/api/webhooks/…"
                      value={hook.url}
                      onChange={(e) => {
                        const webhooks = [...s.discord.webhooks]
                        webhooks[i] = { ...hook, url: e.target.value }
                        setS({ ...s, discord: { ...s.discord, webhooks } })
                      }}
                    />
                  </Field>
                  <div className="flex flex-col gap-1">
                    <span className="text-[12px] font-medium text-fg-muted">{m.webhookEvents}</span>
                    <div className="flex h-9 items-center gap-3">
                      {DISCORD_EVENTS.map((event) => (
                        <label
                          key={event}
                          className="flex items-center gap-1.5 text-[12px] text-fg-muted"
                        >
                          <input
                            type="checkbox"
                            className="size-3.5 accent-brand"
                            checked={hook.events.includes(event)}
                            onChange={() => {
                              const webhooks = [...s.discord.webhooks]
                              const events = hook.events.includes(event)
                                ? hook.events.filter((e) => e !== event)
                                : [...hook.events, event]
                              webhooks[i] = { ...hook, events }
                              setS({ ...s, discord: { ...s.discord, webhooks } })
                            }}
                          />
                          {event}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[12px] font-medium text-fg-muted">
                      {messages.admin.enabled}
                    </span>
                    <div className="flex h-9 items-center">
                      <Toggle
                        size="sm"
                        checked={hook.enabled}
                        ariaLabel={`${m.webhooks} ${hook.name}`}
                        onChange={(v) => {
                          const webhooks = [...s.discord.webhooks]
                          webhooks[i] = { ...hook, enabled: v }
                          setS({ ...s, discord: { ...s.discord, webhooks } })
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex h-9 items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null || dirty || !hook.url}
                      onClick={() =>
                        void runTest({ channel: 'discord', webhookId: hook.id }, hook.id)
                      }
                    >
                      <Send size={13} aria-hidden="true" />
                      {m.test}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={m.removeWebhook}
                      onClick={() =>
                        setS({
                          ...s,
                          discord: {
                            ...s.discord,
                            webhooks: s.discord.webhooks.filter((w) => w.id !== hook.id),
                          },
                        })
                      }
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex flex-col gap-2.5 border-t border-line-soft pt-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-[13px] font-semibold text-fg">{m.roleSync}</span>
                <Hint>{m.roleSyncHint}</Hint>
              </div>
              <div className="flex items-center gap-3">
                <Toggle
                  checked={s.discord.roleSync.enabled}
                  ariaLabel={m.roleSync}
                  disabled={!availability.roleSync.configured}
                  onChange={(v) =>
                    setS({
                      ...s,
                      discord: { ...s.discord, roleSync: { ...s.discord.roleSync, enabled: v } },
                    })
                  }
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!availability.roleSync.configured || busy !== null || dirty}
                  onClick={() => void syncRoles()}
                >
                  <RefreshCw size={13} aria-hidden="true" />
                  {m.syncNow}
                </Button>
              </div>
            </div>
            {availability.roleSync.configured ? null : (
              <Unavailable missing={availability.roleSync.missing} />
            )}
            <div className="flex flex-wrap gap-3">
              {plans.map((plan) => (
                <Field
                  key={plan.id}
                  label={m.planRole.replace('{plan}', plan.name)}
                  htmlFor={`role-${plan.id}`}
                  className="w-56"
                >
                  <input
                    id={`role-${plan.id}`}
                    className={`${inputClass} font-mono text-[12px]`}
                    placeholder="000000000000000000"
                    value={s.discord.roleSync.roles[plan.id] ?? ''}
                    onChange={(e) =>
                      setS({
                        ...s,
                        discord: {
                          ...s.discord,
                          roleSync: {
                            ...s.discord.roleSync,
                            roles: { ...s.discord.roleSync.roles, [plan.id]: e.target.value },
                          },
                        },
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  )
}
