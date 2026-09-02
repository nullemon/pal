'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Button, cn, useToast } from '@palscans/ui'
import {
  Bookmark,
  Check,
  ExternalLink,
  History,
  Pipette,
  Star,
  ThumbsUp,
  TriangleAlert,
  Zap,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { resolveAppearance } from '@/lib/appearance/resolve'
import {
  ACCENT_PRESETS,
  type AppearanceDoc,
  FONT_CHOICES,
  PAIRINGS,
  parseAppearance,
} from '@/lib/appearance/schema'
import { inputClass, Panel, selectClass } from '../ui'
import { postJson, putJson } from './api'
import { Modal, Segmented, Toggle, TopBarActions } from './controls'
import { relativeTime } from './util'

const m = messages.admin.theme

function Section({
  title,
  hint,
  children,
  className,
}: {
  title: string
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Panel className={cn('rounded-[12px] px-4 py-3.5 md:px-4', className)}>
      <div className="flex h-5 items-center justify-between">
        <div className="text-[14px] font-semibold leading-5">{title}</div>
        {hint ? (
          <div className="text-[12px] font-medium leading-4 text-fg-muted">{hint}</div>
        ) : null}
      </div>
      <div className="mt-2.5">{children}</div>
    </Panel>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] font-medium leading-4 text-fg-muted">{children}</div>
}

function Swatch({
  color,
  selected,
  onClick,
  label,
  size = 28,
}: {
  color: string
  selected: boolean
  onClick: () => void
  label?: string
  size?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={selected}
      className="flex w-10 flex-col items-center gap-1"
    >
      <span
        className={cn(
          'rounded-lg transition-transform hover:-translate-y-px',
          selected &&
            'shadow-[0_0_0_2px_var(--color-surface-1),0_0_0_4px_var(--color-brand-hover)]',
        )}
        style={{ width: size, height: size, background: color }}
      />
      {label ? (
        <span className={cn('text-[11px] leading-[14px]', selected ? 'text-fg' : 'text-fg-muted')}>
          {label}
        </span>
      ) : null}
    </button>
  )
}

function HexInput({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  const [text, setText] = useState(value.toUpperCase())
  const commit = (v: string) => {
    const t = v.trim().startsWith('#') ? v.trim() : `#${v.trim()}`
    if (/^#[0-9a-fA-F]{6}$/.test(t)) onChange(t.toLowerCase())
  }
  return (
    <input
      className={cn(inputClass, 'w-32 tracking-[0.03em] tabular-nums', className)}
      value={text}
      onChange={(e) => {
        setText(e.target.value.toUpperCase())
        commit(e.target.value)
      }}
      onBlur={() => setText(value.toUpperCase())}
      aria-label="hex"
    />
  )
}

/** Appearance → Theme, per design/mockups/admin/AdminTheme.dc.html: the token resolver runs live. */
export function ThemeScreen({
  initial,
  hasDraft,
  published,
  versions,
  presets: initialPresets,
}: {
  initial: AppearanceDoc
  hasDraft: boolean
  published: { id: number; publishedAt: string | null; by: string | null } | null
  versions: Array<{
    id: number
    status: string
    createdAt: string
    publishedAt: string | null
    by: string | null
  }>
  presets: Array<{ id: number; name: string; isBuiltin: boolean; doc: AppearanceDoc }>
}) {
  const { toast } = useToast()
  const [saved, setSaved] = useState(initial)
  const [doc, setDoc] = useState(initial)
  const [draft, setDraft] = useState(hasDraft)
  const [busy, setBusy] = useState(false)
  const [presets, setPresets] = useState(initialPresets)
  const [modal, setModal] = useState<'history' | 'preset' | null>(null)
  const [presetName, setPresetName] = useState('')
  const [previewTheme, setPreviewTheme] = useState<'dark' | 'light'>('dark')
  const resolved = useMemo(() => resolveAppearance(doc), [doc])
  const dirty = JSON.stringify(doc) !== JSON.stringify(saved)
  const now = new Date()

  const set = (patch: (d: AppearanceDoc) => AppearanceDoc) =>
    setDoc((d) => parseAppearance(patch(structuredClone(d))))
  const color = (k: 'accent' | 'secondary', v: string) =>
    set((d) => ({ ...d, color: { ...d.color, [k]: v } }))

  const saveDraft = async () => {
    setBusy(true)
    const res = await putJson<{ id: number }>('/api/admin/appearance/theme', { settings: doc })
    setBusy(false)
    if (!res.ok)
      return toast({ title: messages.admin.errorSaving, description: res.message, tone: 'danger' })
    setSaved(doc)
    setDraft(true)
    toast({ title: m.draftSaved, tone: 'ok' })
  }
  const publish = async (versionId?: number) => {
    setBusy(true)
    if (!versionId && dirty) {
      const res = await putJson<{ id: number }>('/api/admin/appearance/theme', { settings: doc })
      if (!res.ok) {
        setBusy(false)
        return toast({
          title: messages.admin.errorSaving,
          description: res.message,
          tone: 'danger',
        })
      }
      setSaved(doc)
    }
    const res = await postJson<{ id: number }>(
      '/api/admin/appearance/theme/publish',
      versionId ? { versionId } : {},
    )
    setBusy(false)
    if (!res.ok)
      return toast({ title: messages.admin.errorSaving, description: res.message, tone: 'danger' })
    setDraft(false)
    toast({ title: versionId ? fmt(m.reverted, { id: versionId }) : m.publishedToast, tone: 'ok' })
    if (versionId) window.location.reload()
  }

  const tokens = previewTheme === 'dark' ? resolved.dark : resolved.light
  const previewStyle = Object.fromEntries(Object.entries(tokens)) as React.CSSProperties
  const cardBorder = doc.shape.card_style === 'flat' ? '0' : '1px solid var(--color-line)'
  const cardShadow =
    doc.shape.card_style === 'elevated' ? '0 10px 30px -12px rgb(0 0 0 / .5)' : 'none'
  const btnRadius = doc.shape.pill_buttons ? 999 : undefined
  const checks = previewTheme === 'dark' ? resolved.contrast.dark : resolved.contrast.light
  const contrastLabel: Record<string, string> = {
    brandOnPage: m.brandOnPage,
    textOnBrand: m.textOnBrand,
    linksOnSurface: m.linksOnSurface,
  }

  return (
    <>
      <TopBarActions>
        <div className="mr-1 hidden text-[13px] text-fg-muted lg:block">
          {published?.publishedAt
            ? fmt(m.lastPublished, {
                time: relativeTime(new Date(published.publishedAt), now),
                name: published.by ?? messages.admin.audit.system,
              })
            : m.neverPublished}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          disabled={!dirty || busy}
          onClick={() => setDoc(saved)}
        >
          {messages.admin.discard}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          disabled={!dirty || busy}
          onClick={saveDraft}
        >
          {m.saveDraft}
        </Button>
        <Button
          size="sm"
          className="h-9 font-semibold"
          disabled={busy || (!dirty && !draft)}
          onClick={() => publish()}
        >
          <Check size={14} aria-hidden="true" />
          {messages.admin.saveChanges}
        </Button>
      </TopBarActions>

      <div className="flex flex-col items-start gap-6 xl:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* 1. accent */}
          <Section title={m.accent} hint={m.accentHint}>
            <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-3">
              <span
                className="size-14 rounded-[12px] shadow-[inset_0_0_0_1px_rgba(255,255,255,.14)]"
                style={{
                  background: resolved.ramp.brand,
                  boxShadow: `inset 0 0 0 1px rgba(255,255,255,.14), 0 4px 14px ${resolved.ramp.wash}`,
                }}
              />
              <HexInput value={doc.color.accent} onChange={(v) => color('accent', v)} />
              <label
                className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md border border-line text-fg-muted hover:bg-surface-2"
                title={m.accent}
              >
                <Pipette size={14} aria-hidden="true" />
                <input
                  type="color"
                  className="sr-only"
                  value={doc.color.accent}
                  onChange={(e) => color('accent', e.target.value)}
                />
              </label>
              <span className="mx-2 h-10 w-px bg-line" />
              <div className="flex gap-1">
                {Object.entries(ACCENT_PRESETS).map(([name, hex]) => (
                  <Swatch
                    key={name}
                    color={hex}
                    selected={doc.color.accent === hex}
                    onClick={() => color('accent', hex)}
                    label={m.presets[name as keyof typeof m.presets]}
                  />
                ))}
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-6 md:flex-row">
              <div className="w-full md:w-[332px] md:shrink-0">
                <Label>{m.derivedRamp}</Label>
                <div className="mt-1 grid grid-cols-6 gap-2">
                  {(
                    [
                      ['brand', resolved.ramp.brand],
                      ['hover', resolved.ramp.hover],
                      ['dim', resolved.ramp.dim],
                      ['wash', resolved.ramp.wash],
                      ['ink', resolved.ramp.ink],
                      ['glow', resolved.ramp.brand],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k}>
                      <div
                        className={cn('h-7 rounded-md', k === 'wash' && 'border border-brand/40')}
                        style={{
                          background: v,
                          ...(k === 'glow'
                            ? {
                                boxShadow: `0 0 0 2px ${resolved.ramp.wash}, 0 0 12px ${resolved.ramp.brand}`,
                              }
                            : {}),
                        }}
                      />
                      <div className="mt-1 text-center text-[11px] leading-[14px] text-fg-muted">
                        {m.ramp[k]}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <Label>{m.contrast}</Label>
                <div className="mt-1 flex flex-col">
                  {checks.map((c, i) => (
                    <div
                      key={c.id}
                      className={cn(
                        'flex h-6 items-center gap-2.5',
                        i > 0 && 'border-t border-line',
                      )}
                    >
                      <div className="flex-1 text-[13px]">{contrastLabel[c.id]}</div>
                      <div className="w-14 text-right text-[13px] font-medium tabular-nums">
                        {c.ratio.toFixed(1)} : 1
                      </div>
                      <div className="flex w-[60px] items-center justify-end gap-1.5">
                        {c.pass ? (
                          <Check size={12} className="text-ok" aria-hidden="true" />
                        ) : (
                          <TriangleAlert size={12} className="text-warn" aria-hidden="true" />
                        )}
                        <span
                          className={cn(
                            'text-[12px] font-semibold',
                            c.pass ? 'text-ok' : 'text-warn',
                          )}
                        >
                          {c.pass ? m.pass : m.warn}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          {/* 2 + 3 */}
          <div className="grid gap-3 md:grid-cols-2">
            <Section title={m.secondary}>
              <div className="flex h-9 items-center gap-2.5">
                <span
                  className="size-9 rounded-md shadow-[inset_0_0_0_1px_rgba(255,255,255,.18)]"
                  style={{ background: resolved.dark['--color-gold'] }}
                />
                <div className="flex flex-col">
                  {doc.color.derive_secondary ? (
                    <div className="text-[13px] font-medium tabular-nums">
                      {resolved.dark['--color-gold']?.toUpperCase()}
                    </div>
                  ) : (
                    <HexInput
                      value={doc.color.secondary}
                      onChange={(v) => color('secondary', v)}
                      className="h-7 w-28"
                    />
                  )}
                  <div className="text-[12px] text-fg-muted">{m.secondaryHint}</div>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[12px] font-medium text-fg-muted">
                    {m.deriveFromAccent}
                  </span>
                  <Toggle
                    size="sm"
                    checked={doc.color.derive_secondary}
                    onChange={(v) =>
                      set((d) => ({ ...d, color: { ...d.color, derive_secondary: v } }))
                    }
                  />
                </div>
              </div>
            </Section>
            <Section title={m.surfaceTint} hint={m.surfaceTintHint}>
              <div className="flex h-9 items-center gap-2.5">
                <span className="w-5 text-[11px] font-medium text-fg-muted">0%</span>
                <input
                  type="range"
                  min={0}
                  max={8}
                  step={0.5}
                  value={doc.color.surface_tint * 100}
                  onChange={(e) =>
                    set((d) => ({
                      ...d,
                      color: { ...d.color, surface_tint: Number(e.target.value) / 100 },
                    }))
                  }
                  className="flex-1 accent-brand"
                  aria-label={m.surfaceTint}
                />
                <span className="w-5 text-right text-[11px] font-medium text-fg-muted">8%</span>
                <span className="flex h-9 w-14 items-center justify-center rounded-md border border-line bg-bg text-[13px] font-medium tabular-nums">
                  {Math.round(doc.color.surface_tint * 100)}%
                </span>
              </div>
            </Section>
          </div>

          {/* 4. theme */}
          <Section title={m.themeSection}>
            <div className="flex flex-wrap items-start gap-8">
              <div className="flex flex-col gap-1">
                <Label>{m.defaultTheme}</Label>
                <Segmented
                  size="sm"
                  value={doc.theme.default}
                  onChange={(v) => set((d) => ({ ...d, theme: { ...d.theme, default: v } }))}
                  options={[
                    { value: 'dark', label: m.dark },
                    { value: 'light', label: m.light },
                    { value: 'system', label: m.system },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>{m.allowSwitch}</Label>
                <div className="flex h-9 items-center">
                  <Toggle
                    size="sm"
                    checked={doc.theme.allow_switch}
                    onChange={(v) => set((d) => ({ ...d, theme: { ...d.theme, allow_switch: v } }))}
                    label={m.allowSwitch}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <Label>{m.readerBackground}</Label>
                <div className="flex h-9 items-center gap-2">
                  {(
                    [
                      ['black', 'var(--color-reader-black)'],
                      ['dark', 'var(--color-reader-dark)'],
                      ['sepia', 'var(--color-reader-sepia)'],
                      ['white', 'var(--color-reader-white)'],
                    ] as const
                  ).map(([k, hex]) => (
                    <button
                      key={k}
                      type="button"
                      aria-label={m.backgrounds[k]}
                      aria-pressed={doc.theme.reader_background === k}
                      onClick={() =>
                        set((d) => ({ ...d, theme: { ...d.theme, reader_background: k } }))
                      }
                      className={cn(
                        'size-6 rounded-md shadow-[inset_0_0_0_1px_var(--color-glass-line-strong)]',
                        doc.theme.reader_background === k &&
                          'shadow-[0_0_0_2px_var(--color-surface-1),0_0_0_4px_var(--color-brand-hover)]',
                      )}
                      style={{ background: hex }}
                    />
                  ))}
                  <span className="ml-1 flex gap-1.5 text-[11px] text-fg-muted">
                    {(['black', 'dark', 'sepia', 'white'] as const).map((k, i) => (
                      <span key={k} className="contents">
                        {i > 0 ? <span className="text-fg-subtle">/</span> : null}
                        <span
                          className={
                            doc.theme.reader_background === k ? 'font-semibold text-fg' : undefined
                          }
                        >
                          {m.backgrounds[k]}
                        </span>
                      </span>
                    ))}
                  </span>
                </div>
              </div>
            </div>
          </Section>

          {/* 5. typography */}
          <Section title={m.typography} hint="">
            <div className="-mt-1 mb-2.5 flex flex-wrap items-center gap-2">
              <span className="mr-0.5 text-[12px] font-medium text-fg-muted">
                {m.pairingPresets}
              </span>
              {Object.entries(PAIRINGS).map(([name, pair]) => (
                <button
                  key={name}
                  type="button"
                  onClick={() =>
                    set((d) => ({
                      ...d,
                      typography: {
                        ...d.typography,
                        pairing: name,
                        display: pair.display,
                        body: pair.body,
                      },
                    }))
                  }
                  className={cn(
                    'h-7 rounded-full border px-2.5 text-[12px] font-medium',
                    doc.typography.pairing === name
                      ? 'border-brand text-fg'
                      : 'border-line text-fg-muted hover:text-fg',
                  )}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-start gap-5">
              {(['display', 'body'] as const).map((k) => (
                <div key={k} className="flex w-60 flex-col gap-1">
                  <Label>{k === 'display' ? m.display : m.body}</Label>
                  <select
                    className={selectClass}
                    value={doc.typography[k]}
                    onChange={(e) =>
                      set((d) => ({ ...d, typography: { ...d.typography, [k]: e.target.value } }))
                    }
                  >
                    {FONT_CHOICES.map((f) => (
                      <option key={f} value={f}>
                        {f.replace(' Variable', '')}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <Label>{m.baseSize}</Label>
                <Segmented
                  size="sm"
                  value={doc.typography.base_size}
                  onChange={(v) =>
                    set((d) => ({ ...d, typography: { ...d.typography, base_size: v } }))
                  }
                  options={[
                    { value: 15, label: '15' },
                    { value: 16, label: '16' },
                    { value: 17, label: '17' },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>{m.headingWeight}</Label>
                <Segmented
                  size="sm"
                  value={doc.typography.heading_weight}
                  onChange={(v) =>
                    set((d) => ({ ...d, typography: { ...d.typography, heading_weight: v } }))
                  }
                  options={[
                    { value: 600, label: '600' },
                    { value: 700, label: '700' },
                    { value: 800, label: '800' },
                  ]}
                />
              </div>
            </div>
          </Section>

          {/* 6. shape */}
          <Section title={m.shape}>
            <div className="flex flex-wrap items-start gap-6">
              <div className="flex flex-col gap-1">
                <Label>{m.radius}</Label>
                <Segmented
                  size="sm"
                  value={doc.shape.radius}
                  onChange={(v) => set((d) => ({ ...d, shape: { ...d.shape, radius: v } }))}
                  options={[
                    { value: 'sharp', label: m.radii.sharp },
                    { value: 'soft', label: m.radii.soft },
                    { value: 'round', label: m.radii.round },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>{m.pillButtons}</Label>
                <div className="flex h-9 items-center">
                  <Toggle
                    size="sm"
                    checked={doc.shape.pill_buttons}
                    onChange={(v) => set((d) => ({ ...d, shape: { ...d.shape, pill_buttons: v } }))}
                    label={m.pillButtons}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <Label>{m.cardStyle}</Label>
                <Segmented
                  size="sm"
                  value={doc.shape.card_style}
                  onChange={(v) => set((d) => ({ ...d, shape: { ...d.shape, card_style: v } }))}
                  options={[
                    { value: 'flat', label: m.cardStyles.flat },
                    { value: 'bordered', label: m.cardStyles.bordered },
                    { value: 'elevated', label: m.cardStyles.elevated },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>{m.density}</Label>
                <Segmented
                  size="sm"
                  value={doc.shape.density}
                  onChange={(v) => set((d) => ({ ...d, shape: { ...d.shape, density: v } }))}
                  options={[
                    { value: 'comfortable', label: m.densities.comfortable },
                    { value: 'compact', label: m.densities.compact },
                  ]}
                />
              </div>
            </div>
          </Section>

          {/* 7. type & status colours */}
          <Section title={m.typeStatus} hint={m.typeStatusHint}>
            <div className="grid gap-8 md:grid-cols-2">
              {(
                [
                  ['type', m.colType, ['manhwa', 'manhua', 'manga', 'comic']],
                  ['status', m.colStatus, ['ongoing', 'completed', 'hiatus', 'cancelled']],
                ] as const
              ).map(([group, title, keys]) => (
                <div key={group} className="flex flex-col">
                  <div className="flex h-4 items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-subtle">
                    <div className="flex-1">{title}</div>
                    <div className="w-10 text-center">{m.colDark}</div>
                    <div className="w-10 text-center">{m.colLight}</div>
                    <div className="w-[72px] text-right">{m.colHex}</div>
                  </div>
                  <div className="mt-1 flex flex-col gap-0.5">
                    {keys.map((k) => {
                      const darkHex = (doc.color[group] as Record<string, string>)[k] ?? '#000000'
                      const lightHex = resolved.light[`--color-${group}-${k}`] ?? darkHex
                      return (
                        <div key={k} className="flex h-6 items-center gap-3">
                          <div className="flex-1 text-[13px] capitalize">{k}</div>
                          <label className="flex h-6 w-10 cursor-pointer items-center justify-center rounded-md border border-line bg-bg">
                            <span
                              className="size-3.5 rounded-[4px]"
                              style={{ background: darkHex }}
                            />
                            <input
                              type="color"
                              className="sr-only"
                              value={darkHex}
                              onChange={(e) =>
                                set((d) => ({
                                  ...d,
                                  color: {
                                    ...d.color,
                                    [group]: {
                                      ...(d.color[group] as Record<string, string>),
                                      [k]: e.target.value,
                                    },
                                  },
                                }))
                              }
                              aria-label={`${k} ${m.colDark}`}
                            />
                          </label>
                          <div className="flex h-6 w-10 items-center justify-center rounded-md bg-preview-light-surface">
                            <span
                              className="size-3.5 rounded-[4px]"
                              style={{ background: lightHex }}
                            />
                          </div>
                          <div className="w-[72px] text-right text-[12px] font-medium tracking-[0.03em] text-fg-muted tabular-nums">
                            {darkHex}
                          </div>
                        </div>
                      )
                    })}
                    {group === 'status' ? (
                      <div className="flex h-6 items-center text-[12px] text-fg-subtle">
                        {m.lightAuto}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* live preview */}
        <aside className="w-full shrink-0 rounded-[12px] border border-line bg-surface-1 px-4 py-3.5 xl:sticky xl:top-[76px] xl:w-[300px]">
          <div className="flex h-5 items-center justify-between">
            <div className="text-[14px] font-semibold">{m.livePreview}</div>
            <button
              type="button"
              onClick={() => setPreviewTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              className="inline-flex h-5 items-center gap-1.5 rounded-full border border-line px-2 text-[11px] font-semibold text-fg-muted hover:text-fg"
            >
              <span className="size-1.5 rounded-full bg-brand-hover" />
              {previewTheme === 'dark' ? m.dark : m.light}
            </button>
          </div>
          <div
            className="mt-2.5 rounded-[10px] border p-3"
            style={{
              ...previewStyle,
              background: 'var(--color-bg)',
              color: 'var(--color-fg)',
              borderColor: 'var(--color-line)',
              fontFamily: 'var(--font-body)',
            }}
          >
            <div
              className="flex h-9 items-center justify-between border-b pb-2.5"
              style={{ borderColor: 'var(--color-line)' }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="flex size-[22px] items-center justify-center rounded-[6px] text-[11px] font-extrabold"
                  style={{ background: 'var(--color-brand)', color: 'var(--color-brand-ink)' }}
                >
                  P
                </span>
                <div className="text-[13px] leading-4">
                  <span className="font-extrabold">PAL</span>
                  <span>Scans</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex h-[26px] items-center px-2.5 text-[11px] font-bold"
                  style={{
                    background: 'var(--color-brand)',
                    color: 'var(--color-brand-ink)',
                    borderRadius: btnRadius ?? 'var(--radius-md)',
                  }}
                >
                  {m.previewCard.premium}
                </span>
                <span
                  className="size-[22px] rounded-full"
                  style={{
                    background:
                      'linear-gradient(135deg, var(--color-gold), var(--color-type-manhwa))',
                  }}
                />
              </div>
            </div>
            <div
              className="mt-2.5 flex gap-2.5 p-2"
              style={{
                background: 'var(--color-surface-1)',
                border: cardBorder,
                borderRadius: 'var(--radius-lg)',
                boxShadow: cardShadow,
              }}
            >
              <div
                className="relative h-[180px] w-[120px] shrink-0 overflow-hidden rounded-[6px]"
                style={{
                  background: `radial-gradient(circle at 30% 22%, ${resolved.ramp.hover}99, transparent 52%), radial-gradient(circle at 75% 80%, var(--color-type-manga)59, transparent 50%), linear-gradient(165deg, var(--color-brand-dim) 0%, var(--color-surface-2) 58%, var(--color-bg-deep) 100%)`,
                }}
              >
                <span className="absolute bottom-2.5 left-2.5 text-[9px] font-bold tracking-[0.08em] text-white/55">
                  {m.previewCard.vol}
                </span>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
                <span
                  className="inline-flex h-[18px] w-fit items-center rounded-[4px] px-1.5 text-[10px] font-bold tracking-[0.06em]"
                  style={{
                    background: 'color-mix(in srgb, var(--color-type-manhwa) 16%, transparent)',
                    color: 'var(--color-type-manhwa)',
                  }}
                >
                  MANHWA
                </span>
                <div
                  className="text-[14px] font-semibold leading-[18px]"
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: doc.typography.heading_weight,
                  }}
                >
                  {m.previewCard.title}
                </div>
                <div
                  className="flex items-center gap-1 text-[13px] font-bold"
                  style={{ color: 'var(--color-gold)' }}
                >
                  <Star size={12} fill="currentColor" aria-hidden="true" />
                  {m.previewCard.rating}
                </div>
                <div className="text-[12px]" style={{ color: 'var(--color-fg-muted)' }}>
                  {m.previewCard.ongoing}
                </div>
              </div>
            </div>
            <div
              className="mt-2 flex h-9 items-center gap-2 px-2.5"
              style={{
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-line)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <span className="text-[13px] font-semibold">{m.previewCard.chapter}</span>
              <span className="text-[12px]" style={{ color: 'var(--color-fg-muted)' }}>
                {m.previewCard.ago}
              </span>
              <span
                className="ml-auto inline-flex h-[18px] items-center rounded-[4px] px-1.5 text-[10px] font-bold tracking-[0.06em]"
                style={{ background: 'var(--color-brand)', color: 'var(--color-brand-ink)' }}
              >
                {m.previewCard.new}
              </span>
            </div>
            <div className="mt-2 flex flex-col gap-2">
              <span
                className="inline-flex h-9 items-center justify-center text-[13px] font-semibold"
                style={{
                  background: 'var(--color-brand)',
                  color: 'var(--color-brand-ink)',
                  borderRadius: btnRadius ?? 'var(--radius-md)',
                }}
              >
                {m.previewCard.continue}
              </span>
              <span
                className="inline-flex h-9 items-center justify-center gap-1.5 text-[13px] font-semibold"
                style={{
                  border: '1px solid var(--color-line)',
                  borderRadius: btnRadius ?? 'var(--radius-md)',
                }}
              >
                <Bookmark size={13} aria-hidden="true" />
                {m.previewCard.bookmark}
              </span>
            </div>
            <div className="mt-2 flex gap-1.5">
              {[m.previewCard.action, m.previewCard.fantasy].map((g) => (
                <span
                  key={g}
                  className="inline-flex h-[26px] items-center rounded-full px-2.5 text-[12px] font-medium"
                  style={{
                    border: '1px solid var(--color-line)',
                    color: 'var(--color-brand-hover)',
                  }}
                >
                  {g}
                </span>
              ))}
            </div>
            <div
              className="mt-2.5 flex items-start gap-2 border-t pt-2.5"
              style={{ borderColor: 'var(--color-line)' }}
            >
              <span
                className="size-7 shrink-0 rounded-full"
                style={{
                  background:
                    'linear-gradient(135deg, var(--color-brand), var(--color-type-manga))',
                }}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex h-4 items-center gap-1.5 whitespace-nowrap">
                  <span className="text-[13px] font-semibold">{m.previewCard.commenter}</span>
                  <span
                    className="inline-flex h-4 items-center gap-[3px] rounded-[4px] px-[5px] text-[9px] font-bold tracking-[0.06em]"
                    style={{
                      background: 'color-mix(in srgb, var(--color-gold) 16%, transparent)',
                      color: 'var(--color-gold)',
                    }}
                  >
                    <Zap size={9} aria-hidden="true" />
                    {m.previewCard.premiumBadge}
                  </span>
                </div>
                <div className="flex gap-1">
                  <span
                    className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold"
                    style={{
                      border: '1px solid var(--color-line)',
                      background: 'var(--color-brand-wash)',
                      color: 'var(--color-brand-hover)',
                    }}
                  >
                    <ThumbsUp size={10} aria-hidden="true" />
                    24
                  </span>
                  <span
                    className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold"
                    style={{
                      border: '1px solid var(--color-line)',
                      color: 'var(--color-fg-muted)',
                    }}
                  >
                    9
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center">
            {draft || dirty ? (
              <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-warn/15 px-2.5 text-[12px] font-semibold text-warn">
                <span className="size-1.5 rounded-full bg-warn" />
                {messages.admin.draftNotPublished}
              </span>
            ) : (
              <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-ok/15 px-2.5 text-[12px] font-semibold text-ok">
                <span className="size-1.5 rounded-full bg-ok" />
                {messages.admin.published}
              </span>
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <a
              href="/?preview=appearance"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-line text-[13px] font-semibold hover:bg-surface-2"
            >
              <ExternalLink size={13} aria-hidden="true" />
              {messages.admin.previewOnSite}
            </a>
            <button
              type="button"
              onClick={() => setModal('history')}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-line text-[13px] font-semibold hover:bg-surface-2"
            >
              <History size={13} aria-hidden="true" />
              {messages.admin.versionHistory}
            </button>
          </div>
          <div className="mt-3 border-t border-line pt-3">
            <div className="mb-1.5 flex items-center justify-between text-[12px] font-medium text-fg-muted">
              {m.presetsPanel}
              <button
                type="button"
                className="text-brand-hover hover:underline"
                onClick={() => setModal('preset')}
              >
                {m.savePreset}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setDoc(p.doc)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line px-2.5 text-[12px] hover:border-fg-subtle"
                >
                  <span
                    className="size-3 rounded-full"
                    style={{ background: p.doc.color.accent }}
                  />
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>

      <Modal open={modal === 'history'} title={m.history} onClose={() => setModal(null)}>
        <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto text-[13px]">
          {versions.map((v) => (
            <li
              key={v.id}
              className="flex items-center gap-2 rounded-md border border-line bg-bg px-3 py-1.5"
            >
              <span className="font-semibold tabular-nums">{fmt(m.version, { id: v.id })}</span>
              <span
                className={cn(
                  'rounded-full px-1.5 text-[10px] font-bold uppercase',
                  v.status === 'published'
                    ? 'bg-ok/15 text-ok'
                    : v.status === 'draft'
                      ? 'bg-warn/15 text-warn'
                      : 'bg-surface-3 text-fg-muted',
                )}
              >
                {m.status[v.status as keyof typeof m.status] ?? v.status}
              </span>
              <span className="text-fg-muted">
                <time dateTime={v.createdAt}>{relativeTime(new Date(v.createdAt), now)}</time> ·{' '}
                {v.by ?? messages.admin.audit.system}
              </span>
              {v.status !== 'published' ? (
                <button
                  type="button"
                  className="ml-auto text-[12px] font-semibold text-brand-hover hover:underline"
                  onClick={() => publish(v.id)}
                >
                  {messages.admin.revert}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </Modal>
      <Modal
        open={modal === 'preset'}
        title={m.savePreset}
        onClose={() => setModal(null)}
        footer={
          <Button
            size="sm"
            disabled={!presetName.trim()}
            onClick={async () => {
              const res = await postJson<{ id: number; name: string; doc: AppearanceDoc }>(
                '/api/admin/appearance/theme/presets',
                { name: presetName, settings: doc },
              )
              if (!res.ok) return toast({ title: messages.admin.errorSaving, tone: 'danger' })
              setPresets((p) => [
                ...p,
                { id: res.data.id, name: res.data.name, isBuiltin: false, doc: res.data.doc },
              ])
              setPresetName('')
              setModal(null)
            }}
          >
            {messages.common.save}
          </Button>
        }
      >
        <input
          className={inputClass}
          placeholder={m.presetName}
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
        />
      </Modal>
    </>
  )
}
