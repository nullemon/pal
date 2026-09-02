'use client'

import { messages } from '@palscans/core/messages'
import { Button, useToast } from '@palscans/ui'
import { X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { CommentSettings } from '@/lib/comments/settings'
import { Field, inputClass, Panel, PanelHeader, selectClass } from '../ui'
import { del, postJson, putJson } from './api'
import { SaveBar, Toggle } from './controls'

interface Filter {
  id: number
  pattern: string
  isRegex: boolean
  action: string
  replacement: string | null
}

export function CommentSettingsForm({
  initial,
  filters: initialFilters,
  allowlist: initialAllow,
}: {
  initial: CommentSettings
  filters: Filter[]
  allowlist: string[]
}) {
  const m = messages.admin.moderation.settings
  const { toast } = useToast()
  const [saved, setSaved] = useState(initial)
  const [s, setS] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [filters, setFilters] = useState(initialFilters)
  const [allow, setAllow] = useState(initialAllow)
  const [draft, setDraft] = useState<{
    pattern: string
    isRegex: boolean
    action: 'block' | 'hold' | 'replace'
    replacement: string
  }>({ pattern: '', isRegex: false, action: 'hold', replacement: '' })
  const [domain, setDomain] = useState('')
  const [test, setTest] = useState('')
  const dirty = JSON.stringify(s) !== JSON.stringify(saved)

  const matches = useMemo(() => {
    if (!test.trim()) return []
    return filters.filter((f) => {
      try {
        return f.isRegex
          ? new RegExp(f.pattern, 'i').test(test)
          : test.toLowerCase().includes(f.pattern.toLowerCase())
      } catch {
        return false
      }
    })
  }, [test, filters])

  const num = (label: string, key: keyof CommentSettings, opts?: { nullable?: boolean }) => (
    <Field label={label} htmlFor={`cs-${String(key)}`}>
      <input
        id={`cs-${String(key)}`}
        type="number"
        className={inputClass}
        value={(s[key] as number | null) ?? ''}
        onChange={(e) =>
          setS({
            ...s,
            [key]: e.target.value === '' ? (opts?.nullable ? null : 0) : Number(e.target.value),
          })
        }
      />
    </Field>
  )
  const bool = (label: string, key: keyof CommentSettings) => (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      {label}
      <Toggle
        ariaLabel={label}
        size="sm"
        checked={Boolean(s[key])}
        onChange={(v) => setS({ ...s, [key]: v })}
      />
    </div>
  )

  return (
    <div className="grid gap-3.5 lg:grid-cols-2">
      <SaveBar
        dirty={dirty}
        saving={saving}
        onDiscard={() => setS(saved)}
        onSave={async () => {
          setSaving(true)
          const res = await putJson<CommentSettings>('/api/admin/comments/settings', s)
          setSaving(false)
          if (!res.ok)
            return toast({
              title: messages.admin.errorSaving,
              description: res.message,
              tone: 'danger',
            })
          setSaved(res.data)
          setS(res.data)
          toast({ title: messages.admin.saved, tone: 'ok' })
        }}
      />
      <Panel>
        <PanelHeader title={m.general} />
        <div className="flex flex-col gap-3">
          {bool(m.enabled, 'enabled')}
          {bool(m.requireVerified, 'require_verified_email')}
          {num(m.minAccountAge, 'min_account_age_minutes')}
          {bool(m.holdLinks, 'hold_links')}
          {num(m.holdNewHours, 'hold_new_accounts_hours')}
          {num(m.holdNewFirstN, 'hold_new_accounts_first_n')}
          {num(m.maxMentions, 'max_mentions')}
          {num(m.editWindow, 'edit_window_minutes')}
          {num(m.collapseThreshold, 'collapse_threshold')}
          {num(m.autoLock, 'auto_lock_days', { nullable: true })}
          {bool(m.lockdown, 'lockdown')}
        </div>
      </Panel>
      <div className="flex flex-col gap-3.5">
        <Panel>
          <PanelHeader title={m.images} />
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 text-[13px]">
              {m.collection}
              <Toggle
                ariaLabel={m.collection}
                size="sm"
                checked={s.images.collection}
                onChange={(v) => setS({ ...s, images: { ...s.images, collection: v } })}
              />
            </div>
            <Field label={m.customGifs}>
              <select
                className={selectClass}
                value={s.images.custom_gifs}
                onChange={(e) =>
                  setS({
                    ...s,
                    images: {
                      ...s.images,
                      custom_gifs: e.target.value as CommentSettings['images']['custom_gifs'],
                    },
                  })
                }
              >
                <option value="off">off</option>
                <option value="premium">premium</option>
                <option value="all">all</option>
              </select>
            </Field>
          </div>
        </Panel>
        <Panel>
          <PanelHeader title={m.rateLimits} />
          <div className="grid grid-cols-2 gap-3">
            {(['per_minute', 'per_hour', 'new_per_minute', 'new_per_hour'] as const).map((k) => (
              <Field
                key={k}
                label={
                  m[
                    k === 'per_minute'
                      ? 'perMinute'
                      : k === 'per_hour'
                        ? 'perHour'
                        : k === 'new_per_minute'
                          ? 'newPerMinute'
                          : 'newPerHour'
                  ]
                }
              >
                <input
                  type="number"
                  className={inputClass}
                  value={s.rate_limits[k]}
                  onChange={(e) =>
                    setS({ ...s, rate_limits: { ...s.rate_limits, [k]: Number(e.target.value) } })
                  }
                />
              </Field>
            ))}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title={m.automod} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={m.automodHold}>
              <input
                type="number"
                className={inputClass}
                value={s.automod.hold}
                onChange={(e) =>
                  setS({ ...s, automod: { ...s.automod, hold: Number(e.target.value) } })
                }
              />
            </Field>
            <Field label={m.automodShadow}>
              <input
                type="number"
                className={inputClass}
                value={s.automod.shadow}
                onChange={(e) =>
                  setS({ ...s, automod: { ...s.automod, shadow: Number(e.target.value) } })
                }
              />
            </Field>
            <Field label={m.reportUnique}>
              <input
                type="number"
                className={inputClass}
                value={s.report_threshold.unique}
                onChange={(e) =>
                  setS({
                    ...s,
                    report_threshold: { ...s.report_threshold, unique: Number(e.target.value) },
                  })
                }
              />
            </Field>
            <Field label={m.reportPremium}>
              <input
                type="number"
                className={inputClass}
                value={s.report_threshold.premium}
                onChange={(e) =>
                  setS({
                    ...s,
                    report_threshold: { ...s.report_threshold, premium: Number(e.target.value) },
                  })
                }
              />
            </Field>
          </div>
        </Panel>
      </div>
      <Panel>
        <PanelHeader title={m.wordFilters} hint={m.wordFiltersHint} />
        <ul className="mb-3 flex flex-col gap-1.5">
          {filters.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-2 rounded-md border border-line bg-bg px-3 py-1.5 text-[13px]"
            >
              <code className="font-mono text-[12px]">{f.pattern}</code>
              {f.isRegex ? (
                <span className="text-[10px] font-bold uppercase text-fg-subtle">regex</span>
              ) : null}
              <span className="rounded-sm bg-surface-3 px-1.5 text-[11px] font-semibold">
                {f.action}
              </span>
              {f.replacement ? <span className="text-fg-muted">→ {f.replacement}</span> : null}
              <button
                type="button"
                aria-label={messages.admin.remove}
                className="ml-auto text-fg-muted hover:text-danger"
                onClick={() =>
                  void del(`/api/admin/comments/filters/${f.id}`).then(
                    (r) => r.ok && setFilters((fs) => fs.filter((x) => x.id !== f.id)),
                  )
                }
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-[1fr_auto_auto_1fr_auto] items-end gap-2">
          <Field label={m.pattern}>
            <input
              className={inputClass}
              value={draft.pattern}
              onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
            />
          </Field>
          <label className="flex h-9 items-center gap-1.5 text-[12px] text-fg-muted">
            <input
              type="checkbox"
              checked={draft.isRegex}
              onChange={(e) => setDraft({ ...draft, isRegex: e.target.checked })}
            />{' '}
            {m.isRegex}
          </label>
          <Field label={m.action}>
            <select
              className={selectClass}
              value={draft.action}
              onChange={(e) =>
                setDraft({ ...draft, action: e.target.value as typeof draft.action })
              }
            >
              <option value="block">block</option>
              <option value="hold">hold</option>
              <option value="replace">replace</option>
            </select>
          </Field>
          <Field label={m.replacement}>
            <input
              className={inputClass}
              value={draft.replacement}
              disabled={draft.action !== 'replace'}
              onChange={(e) => setDraft({ ...draft, replacement: e.target.value })}
            />
          </Field>
          <Button
            size="sm"
            className="h-9"
            disabled={!draft.pattern.trim()}
            onClick={async () => {
              const res = await postJson<Filter>('/api/admin/comments/filters', {
                ...draft,
                replacement: draft.action === 'replace' ? draft.replacement || null : null,
              })
              if (!res.ok)
                return toast({
                  title: messages.admin.errorSaving,
                  description: res.message,
                  tone: 'danger',
                })
              setFilters((fs) => [res.data, ...fs])
              setDraft({ pattern: '', isRegex: false, action: 'hold', replacement: '' })
            }}
          >
            {m.addFilter}
          </Button>
        </div>
        <div className="mt-3">
          <input
            className={inputClass}
            placeholder={m.testBox}
            value={test}
            onChange={(e) => setTest(e.target.value)}
          />
          {test.trim() ? (
            <p className="mt-1 text-[12px] text-fg-muted">
              {matches.length
                ? m.testMatch.replace(
                    '{rules}',
                    matches.map((f) => `${f.pattern} (${f.action})`).join(', '),
                  )
                : m.testNoMatch}
            </p>
          ) : null}
        </div>
      </Panel>
      <Panel>
        <PanelHeader title={m.allowlist} hint={m.allowlistHint} />
        <ul className="mb-3 flex flex-wrap gap-1.5">
          {allow.map((d) => (
            <li
              key={d}
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line px-3 text-[12px]"
            >
              {d}
              <button
                type="button"
                aria-label={messages.admin.remove}
                className="text-fg-muted hover:text-danger"
                onClick={() =>
                  void del('/api/admin/comments/allowlist', { domain: d }).then(
                    (r) => r.ok && setAllow((a) => a.filter((x) => x !== d)),
                  )
                }
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input
            className={inputClass}
            placeholder={m.domain}
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
          <Button
            size="sm"
            className="h-9"
            disabled={!domain.trim()}
            onClick={async () => {
              const res = await postJson<{ domain: string }>('/api/admin/comments/allowlist', {
                domain,
              })
              if (!res.ok)
                return toast({
                  title: messages.admin.errorSaving,
                  description: res.message,
                  tone: 'danger',
                })
              setAllow((a) => [...new Set([...a, res.data.domain])].sort())
              setDomain('')
            }}
          >
            {m.addDomain}
          </Button>
        </div>
      </Panel>
    </div>
  )
}
