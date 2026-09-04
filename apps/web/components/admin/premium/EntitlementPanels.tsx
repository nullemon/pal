'use client'

import {
  type EntitlementOverrides,
  FEATURE_MODES,
  FEATURES,
  type Feature,
  type FeatureMode,
  featureMode,
  MAX_EARLY_ACCESS_MINUTES,
  promotionActive,
} from '@palscans/core/entitlements'
import { fmt, messages } from '@palscans/core/messages'
import { Button, useToast } from '@palscans/ui'
import { CircleSlash, Gift, Lock, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { putJson } from '../client/api'
import { SaveBar, Segmented, Toggle } from '../client/controls'
import { countdown } from '../client/util'
import { Field, Hint, inputClass, Panel, PanelHeader, Pill, Table, Td, Th } from '../ui'

const m = messages.admin.premium

/** `2026-09-02T18:30` in the operator's timezone ↔ the stored UTC ISO string. */
const toLocalInput = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const fromLocalInput = (value: string): string | null => {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const modeOptions = FEATURE_MODES.map((mode) => ({ value: mode, label: m.modes[mode] }))

function ModePill({ mode }: { mode: FeatureMode }) {
  if (mode === 'free')
    return (
      <Pill tone="ok">
        <Gift size={10} aria-hidden="true" className="mr-1" />
        {m.modes.free}
      </Pill>
    )
  if (mode === 'disabled')
    return (
      <Pill tone="danger">
        <CircleSlash size={10} aria-hidden="true" className="mr-1" />
        {m.modes.disabled}
      </Pill>
    )
  return (
    <Pill tone="brand">
      <Lock size={10} aria-hidden="true" className="mr-1" />
      {m.modes.premium}
    </Pill>
  )
}

/**
 * docs/17 §B — `Admin → Business → Premium`. One row per feature with a three-way control,
 * the "all premium features free" master switch and the window that ends the promotion by
 * itself. Everything here writes `settings.entitlements`; the gates read it per request.
 */
export function EntitlementPanels({ initial }: { initial: EntitlementOverrides }) {
  const { toast } = useToast()
  const [saved, setSaved] = useState(initial)
  const [s, setS] = useState(initial)
  const [saving, setSaving] = useState(false)
  // Re-render once a minute so "Ends in 4h 12m" stays honest without a save.
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const dirty = JSON.stringify(s) !== JSON.stringify(saved)
  const now = new Date(tick)
  const effective = (f: Feature): FeatureMode => featureMode(s, f, now)
  const live = promotionActive(s, now)
  const freeCount = FEATURES.filter((f) => effective(f) === 'free').length
  const disabledCount = FEATURES.filter((f) => effective(f) === 'disabled').length
  const ends = s.all_free && s.free_until ? new Date(s.free_until) : null
  const windowPassed = !!ends && ends.getTime() <= now.getTime()

  return (
    <div className="flex flex-col gap-3.5">
      <SaveBar
        dirty={dirty}
        saving={saving}
        onDiscard={() => setS(saved)}
        status={
          live ? (
            <span className="inline-flex items-center gap-1.5 text-ok">
              <span className="size-[7px] rounded-full bg-ok" aria-hidden="true" />
              {m.promotionLive}
            </span>
          ) : null
        }
        onSave={async () => {
          setSaving(true)
          const res = await putJson<EntitlementOverrides>('/api/admin/entitlements', s)
          setSaving(false)
          if (!res.ok)
            return toast({
              title: messages.admin.errorSaving,
              description: res.message,
              tone: 'danger',
            })
          setSaved(res.data)
          setS(res.data)
          toast({ title: m.saved, tone: 'ok' })
        }}
      />

      <Panel>
        <PanelHeader
          title={m.masterTitle}
          hint={m.masterHint}
          aside={
            <span>
              {fmt(m.summaryFree, { n: freeCount, total: FEATURES.length })}
              {disabledCount > 0 ? ` ${fmt(m.summaryDisabled, { n: disabledCount })}` : ''}
            </span>
          }
        />
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
          <Field label={messages.admin.enabled}>
            <div className="flex h-9 items-center">
              <Toggle
                checked={s.all_free}
                onChange={(all_free) => setS({ ...s, all_free })}
                ariaLabel={m.masterTitle}
                label={m.masterTitle}
              />
            </div>
          </Field>
          <Field label={m.windowLabel} hint={m.windowHint} htmlFor="free-until" className="w-64">
            <input
              id="free-until"
              type="datetime-local"
              className={inputClass}
              disabled={!s.all_free}
              value={toLocalInput(s.free_until)}
              onChange={(e) => setS({ ...s, free_until: fromLocalInput(e.target.value) })}
            />
          </Field>
          <Field
            label={m.earlyLabel}
            hint={m.earlyHint}
            htmlFor="early-access-minutes"
            className="w-64"
          >
            <input
              id="early-access-minutes"
              type="number"
              min={0}
              max={MAX_EARLY_ACCESS_MINUTES}
              step={1}
              className={inputClass}
              value={s.early_access_minutes}
              onChange={(e) =>
                setS({
                  ...s,
                  early_access_minutes: Math.min(
                    Math.max(Math.round(Number(e.target.value) || 0), 0),
                    MAX_EARLY_ACCESS_MINUTES,
                  ),
                })
              }
            />
            <Hint>
              {s.early_access_minutes === 0
                ? m.earlyOff
                : fmt(m.earlyOn, { minutes: String(s.early_access_minutes) })}
            </Hint>
          </Field>
          <Field label={m.inForce}>
            <div className="flex h-9 items-center gap-2 text-[13px]">
              {!s.all_free ? (
                <span className="text-fg-subtle">{messages.admin.off}</span>
              ) : ends === null ? (
                <span className="text-fg-muted">{m.windowClear}</span>
              ) : windowPassed ? (
                <span className="text-warn">{m.endedAlready}</span>
              ) : (
                <span className="font-semibold text-ok">
                  {fmt(m.endsIn, { countdown: countdown(ends, now) })}
                </span>
              )}
            </div>
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title={m.featuresTitle} hint={m.featuresHint} />
        <Table>
          <thead>
            <tr>
              <Th>{m.feature}</Th>
              <Th>{m.whatItDoes}</Th>
              <Th>{m.access}</Th>
              <Th>{m.inForce}</Th>
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((f) => (
              <tr key={f} className="align-middle">
                <Td className="py-2.5 whitespace-nowrap font-semibold">{m.features[f]}</Td>
                <Td className="py-2.5 text-fg-muted">{m.featureHints[f]}</Td>
                <Td className="py-2">
                  <Segmented
                    size="sm"
                    ariaLabel={m.features[f]}
                    value={s.features[f]}
                    options={modeOptions}
                    onChange={(mode) =>
                      setS({ ...s, features: { ...s.features, [f]: mode as FeatureMode } })
                    }
                  />
                </Td>
                <Td className="py-2.5">
                  <ModePill mode={effective(f)} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Hint className="mt-3">{m.anonymousNote}</Hint>
      </Panel>

      <Panel>
        <PanelHeader title={m.grantsTitle} hint={m.grantsHint} />
        <Button href="/admin/users" variant="outline" size="sm">
          <Users size={14} aria-hidden="true" />
          {m.grantsCta}
        </Button>
      </Panel>
    </div>
  )
}
