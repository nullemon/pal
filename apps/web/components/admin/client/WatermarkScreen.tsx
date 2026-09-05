'use client'

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import {
  WATERMARK_CORNERS,
  WATERMARK_LIMITS,
  type WatermarkConfig,
  type WatermarkCounts,
  type WatermarkRun,
} from '@palscans/core/watermark'
import { Button, cn, useToast } from '@palscans/ui'
import {
  Ban,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  History,
  RefreshCw,
  Square,
  TriangleAlert,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { Field, Hint, inputClass, PageHeader, Panel, PanelHeader, Pill } from '../ui'
import { api, patchJson, postJson, putJson } from './api'
import { SaveBar, Segmented, Toggle } from './controls'

const copy = adminMessages.admin.watermark
const common = adminMessages.admin

const PREVIEW_WIDTHS = [480, 720, 1080, 1440] as const

/** What GET /api/admin/appearance/watermark/reapply answers with. */
export interface WatermarkStatus {
  run: WatermarkRun | null
  counts: WatermarkCounts
}

const RUN_NOTE: Record<WatermarkRun['status'], string> = {
  queued: copy.run.queued,
  running: copy.run.running,
  done: copy.run.done,
  cancelled: copy.run.cancelled,
  failed: copy.run.failed,
}

const RUN_TONE: Record<WatermarkRun['status'], 'ok' | 'warn' | 'danger' | 'brand' | undefined> = {
  queued: 'brand',
  running: 'brand',
  done: 'ok',
  cancelled: 'warn',
  failed: 'danger',
}

const nf = new Intl.NumberFormat('en-GB')

const bytes = (n: number): string => {
  if (n <= 0) return '0 MB'
  const mb = n / (1024 * 1024)
  return mb < 1 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${nf.format(Math.round(mb))} MB`
}

const when = (iso: string): string => new Date(iso).toLocaleString(undefined, { hour12: false })

/**
 * A count with its meaning spelled out.
 *
 * The icon and the wording carry the state; the colour only reinforces it. An operator
 * reading this in greyscale still learns which bucket is the problem.
 */
function CountTile({
  icon,
  label,
  hint,
  value,
  tone,
}: {
  icon: ReactNode
  label: string
  hint: string
  value: number
  tone?: 'ok' | 'warn' | 'danger'
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 p-3">
      <div className="flex items-center gap-1.5 text-[12px] font-medium leading-4 text-fg-muted">
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex',
            tone === 'ok' && 'text-ok',
            tone === 'warn' && 'text-warn',
            tone === 'danger' && 'text-danger',
          )}
        >
          {icon}
        </span>
        {label}
      </div>
      <div className="mt-1 font-body text-[24px] font-bold leading-7 tabular-nums">
        {nf.format(value)}
      </div>
      <p className="mt-1 text-[12px] leading-4 text-fg-subtle">{hint}</p>
    </div>
  )
}

/**
 * Applying the mark to what already exists.
 *
 * Saving the settings above genuinely changes nothing that is published — page objects are
 * content-addressed and immutable — so this panel exists to say so in numbers and to do
 * something about it. The work is a background run: it walks the catalogue a chapter at a
 * time, rebuilding pages from the uploaded originals, and it is resumable, stoppable and
 * honest about the chapters whose originals are gone and therefore cannot be fixed here.
 */
function ReapplyPanel({
  status,
  onStatus,
  canReapply,
  dirty,
}: {
  status: WatermarkStatus
  onStatus: (next: WatermarkStatus) => void
  canReapply: boolean
  dirty: boolean
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const { run, counts } = status
  const live = !!run && (run.status === 'queued' || run.status === 'running')

  useEffect(() => {
    if (!live) return
    let stopped = false
    const timer = setInterval(() => {
      void api<WatermarkStatus>('/api/admin/appearance/watermark/reapply').then((res) => {
        if (!stopped && res.ok) onStatus(res.data)
      })
    }, 2000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [live, onStatus])

  const start = async () => {
    setBusy(true)
    const res = await postJson<WatermarkStatus>('/api/admin/appearance/watermark/reapply', {})
    setBusy(false)
    if (!res.ok)
      return toast({
        title: res.status === 409 ? copy.reapplyBusy : common.errorSaving,
        description: res.status === 409 ? undefined : res.message,
        tone: 'danger',
      })
    onStatus(res.data)
    toast({ title: copy.reapplyStarted, tone: 'ok' })
  }

  const stop = async () => {
    if (!window.confirm(copy.confirmStop)) return
    setBusy(true)
    const res = await patchJson<WatermarkStatus>('/api/admin/appearance/watermark/reapply', {
      action: 'cancel',
    })
    setBusy(false)
    if (!res.ok)
      return toast({ title: common.errorSaving, description: res.message, tone: 'danger' })
    onStatus(res.data)
  }

  const total = run?.totals.chapters ?? 0
  const done = run?.totals.done ?? 0
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0

  return (
    <Panel>
      <PanelHeader title={copy.applyTitle} />
      <Hint>{copy.applyBody}</Hint>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <CountTile
          icon={<CheckCircle2 size={13} />}
          tone="ok"
          label={copy.counts.current}
          hint={copy.counts.currentHint}
          value={counts.current}
        />
        <CountTile
          icon={<History size={13} />}
          tone={counts.stale > 0 ? 'warn' : undefined}
          label={copy.counts.stale}
          hint={copy.counts.staleHint}
          value={counts.stale}
        />
        <CountTile
          icon={<HelpCircle size={13} />}
          tone={counts.unknown > 0 ? 'warn' : undefined}
          label={copy.counts.unknown}
          hint={copy.counts.unknownHint}
          value={counts.unknown}
        />
        <CountTile
          icon={<Ban size={13} />}
          tone={counts.unmarkable > 0 ? 'danger' : undefined}
          label={copy.counts.unmarkable}
          hint={copy.counts.unmarkableHint}
          value={counts.unmarkable}
        />
      </div>

      {counts.unmarkable > 0 ? (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/8 p-2.5 text-[12.5px] leading-[18px] text-fg">
          <TriangleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          {fmt(copy.unmarkableWarning, { n: nf.format(counts.unmarkable) })}
        </p>
      ) : null}

      {canReapply ? (
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          {live ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void stop()}>
              <Square size={13} aria-hidden="true" />
              {copy.stop}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy || dirty || counts.affected === 0}
              onClick={() => void start()}
            >
              <RefreshCw size={13} aria-hidden="true" />
              {counts.affected === 0
                ? copy.reapplyNone
                : fmt(copy.reapply, { n: nf.format(counts.affected) })}
            </Button>
          )}
          {run ? <Pill tone={RUN_TONE[run.status]}>{copy.run.pill[run.status]}</Pill> : null}
        </div>
      ) : null}
      <Hint className="mt-2">{copy.reapplyHint}</Hint>

      {run ? (
        <div className="mt-3.5 border-t border-line pt-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[12.5px] font-bold">{copy.run.title}</span>
            <span className="text-[12px] text-fg-muted">
              {run.label ? fmt(copy.run.markLabel, { mark: run.label }) : copy.run.markNone} ·{' '}
              {fmt(copy.run.startedWhen, { when: when(run.startedAt) })}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2.5">
            <div
              className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total || 1}
              aria-valuenow={done}
              aria-label={copy.run.title}
            >
              <div
                className={cn('h-full rounded-full', live ? 'bg-brand' : 'bg-fg-subtle')}
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="text-[12px] font-medium tabular-nums text-fg-muted">
              {fmt(copy.run.progress, { done: nf.format(done), total: nf.format(total) })}
            </span>
          </div>
          <p className="mt-2 text-[12.5px] leading-[18px] text-fg-muted">
            {run.cancelRequested && live ? copy.run.stopping : RUN_NOTE[run.status]}
            {run.error
              ? ` ${
                  copy.run.errors[run.error as keyof typeof copy.run.errors] ??
                  (run.error as string)
                }`
              : ''}
          </p>
          <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {(
              [
                [copy.run.rebuilt, run.totals.rewritten],
                [copy.run.alreadyCurrent, run.totals.alreadyCurrent],
                [copy.run.skipped, run.totals.skipped],
                [copy.run.pages, run.totals.pages],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-md border border-line bg-bg px-2.5 py-2">
                <div className="text-[11.5px] leading-4 text-fg-muted">{label}</div>
                <div className="font-body text-[17px] font-bold leading-6 tabular-nums">
                  {nf.format(value)}
                </div>
              </div>
            ))}
            <div className="rounded-md border border-line bg-bg px-2.5 py-2">
              <div className="text-[11.5px] leading-4 text-fg-muted">{copy.run.orphaned}</div>
              <div className="font-body text-[17px] font-bold leading-6 tabular-nums">
                {bytes(run.totals.orphanBytes)}
              </div>
            </div>
          </div>
          <Hint>{copy.run.orphanedHint}</Hint>
          {run.problems.length > 0 ? (
            <div className="mt-3 rounded-md border border-warn/40 bg-warn/8 p-2.5">
              <div className="mb-1 text-[12.5px] font-bold text-warn">{copy.run.problems}</div>
              <ul className="flex flex-col gap-1 text-[12.5px] leading-[18px] text-fg-muted">
                {run.problems.slice(0, 10).map((p) => (
                  <li key={p.chapterId}>
                    <a
                      className="font-semibold text-brand-hover hover:underline"
                      href={`/admin/chapters?chapter=${p.chapterId}`}
                    >
                      {p.number !== undefined ? `Ch. ${p.number}` : `#${p.chapterId}`}
                    </a>{' '}
                    — {copy.run.reasons[p.reason]}
                    {p.detail ? ` (${p.detail})` : ''}
                  </li>
                ))}
              </ul>
              {run.problems.length > 10 ? (
                <p className="mt-1 text-[12px] text-fg-subtle">
                  {fmt(copy.run.problemsMore, { n: String(run.problems.length - 10) })}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <a
        href="/admin/chapters?mark=stale"
        className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-hover hover:underline"
      >
        {copy.openChapters}
        <ExternalLink size={12} aria-hidden="true" />
      </a>
    </Panel>
  )
}

/** A labelled range with the numeric readout, matching the Theme screen's tint slider. */
function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  suffix,
  format,
  onChange,
  disabled,
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
  format: (v: number) => string
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] font-medium leading-4 text-fg-muted">{label}</span>
      <div className="flex h-9 items-center gap-2.5">
        <span className="w-8 text-[11px] font-medium text-fg-muted tabular-nums">
          {format(min)}
        </span>
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-brand disabled:opacity-40"
        />
        <span className="w-8 text-right text-[11px] font-medium text-fg-muted tabular-nums">
          {format(max)}
        </span>
        <span className="flex h-9 w-16 items-center justify-center rounded-md border border-line bg-bg text-[13px] font-medium tabular-nums">
          {format(value)}
          {suffix}
        </span>
      </div>
      <span className="text-[12px] leading-4 text-fg-subtle">{hint}</span>
    </div>
  )
}

/**
 * Appearance → Watermark.
 *
 * The preview is not a mock-up: it calls the same geometry and SVG the worker composites
 * with, on a real page out of the catalogue, and returns the actual pixels. That is what
 * makes this screen trustworthy — an operator can see the mark land on dark and on light
 * artwork before a single chapter is processed with it.
 */
export function WatermarkScreen({
  initial,
  fontAvailable,
  status: initialStatus,
  canReapply,
}: {
  initial: WatermarkConfig
  fontAvailable: boolean
  status: WatermarkStatus
  canReapply: boolean
}) {
  const { toast } = useToast()
  const [status, setStatus] = useState(initialStatus)
  const onStatus = useCallback((next: WatermarkStatus) => setStatus(next), [])
  const [saved, setSaved] = useState(initial)
  const [s, setS] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [width, setWidth] = useState<(typeof PREVIEW_WIDTHS)[number]>(720)
  const [tone, setTone] = useState<'dark' | 'light'>('dark')
  const [view, setView] = useState<'corner' | 'page'>('corner')
  // Keyed by the URL that failed, so a new set of settings retries instead of staying dead.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const dirty = useMemo(() => JSON.stringify(s) !== JSON.stringify(saved), [s, saved])

  // Debounced so dragging a slider does not fire a render per pixel.
  const [debounced, setDebounced] = useState(s)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(s), 200)
    return () => clearTimeout(t)
  }, [s])

  const previewSrc = useMemo(() => {
    const q = new URLSearchParams({
      width: String(width),
      text: debounced.text || ' ',
      corner: debounced.corner,
      scale: String(debounced.scale),
      margin: String(debounced.margin),
      opacity: String(debounced.opacity),
      view,
      tone,
    })
    return `/api/admin/appearance/watermark/preview?${q.toString()}`
  }, [debounced, width, view, tone])

  const failed = failedSrc === previewSrc

  const save = async () => {
    setSaving(true)
    const res = await putJson<WatermarkConfig>('/api/admin/appearance/watermark', s)
    setSaving(false)
    if (!res.ok)
      return toast({ title: common.errorSaving, description: res.message, tone: 'danger' })
    setSaved(res.data)
    setS(res.data)
    // Say plainly what the save did *not* do. The counts move the moment the fingerprint
    // changes, so a chapter that was "current" a second ago is now on an older mark.
    const fresh = await api<WatermarkStatus>('/api/admin/appearance/watermark/reapply')
    if (fresh.ok) setStatus(fresh.data)
    const affected = fresh.ok ? fresh.data.counts.affected : status.counts.affected
    toast({
      title: copy.saved,
      description:
        affected > 0
          ? fmt(copy.savedStale, { n: new Intl.NumberFormat('en-GB').format(affected) })
          : copy.savedAllCurrent,
      // The toast is the nudge; the permanent statement of fact is the panel below it.
      tone: affected > 0 ? 'neutral' : 'ok',
    })
  }

  return (
    <>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => setS(saved)} />
      <PageHeader title={copy.title} subtitle={copy.subtitle} />
      {fontAvailable ? null : (
        <Panel className="border-warn/50 bg-warn/8">
          <p className="flex items-start gap-2 text-[13px] leading-5 text-fg">
            <TriangleAlert size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-warn" />
            {copy.noFont}
          </p>
        </Panel>
      )}
      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3.5">
          <Panel>
            <PanelHeader title={copy.enable} hint={copy.enableHint} />
            <Toggle
              checked={s.enabled}
              onChange={(enabled) => setS({ ...s, enabled })}
              label={copy.enable}
            />
          </Panel>
          <Panel>
            <div className="flex flex-col gap-3.5">
              <Field label={copy.textLabel} hint={copy.textHint} htmlFor="wm-text">
                <input
                  id="wm-text"
                  className={inputClass}
                  maxLength={WATERMARK_LIMITS.textMaxLength}
                  value={s.text}
                  onChange={(e) => setS({ ...s, text: e.target.value })}
                />
              </Field>
              <div className="flex flex-col gap-1">
                <span className="text-[12px] font-medium leading-4 text-fg-muted">
                  {copy.cornerLabel}
                </span>
                <Segmented
                  ariaLabel={copy.cornerLabel}
                  size="sm"
                  value={s.corner}
                  onChange={(corner) => setS({ ...s, corner })}
                  options={WATERMARK_CORNERS.map((c) => ({ value: c, label: copy.corners[c] }))}
                />
              </div>
              <Slider
                label={copy.sizeLabel}
                hint={copy.sizeHint}
                value={s.scale}
                min={WATERMARK_LIMITS.scale.min}
                max={WATERMARK_LIMITS.scale.max}
                step={WATERMARK_LIMITS.scale.step}
                suffix="%"
                format={(v) => v.toFixed(1)}
                onChange={(scale) => setS({ ...s, scale })}
              />
              <Slider
                label={copy.marginLabel}
                hint={copy.marginHint}
                value={s.margin}
                min={WATERMARK_LIMITS.margin.min}
                max={WATERMARK_LIMITS.margin.max}
                step={WATERMARK_LIMITS.margin.step}
                suffix="%"
                format={(v) => v.toFixed(1)}
                onChange={(margin) => setS({ ...s, margin })}
              />
              <Slider
                label={copy.opacityLabel}
                hint={copy.opacityHint}
                value={Math.round(s.opacity * 100)}
                min={Math.round(WATERMARK_LIMITS.opacity.min * 100)}
                max={100}
                step={1}
                suffix="%"
                format={(v) => String(Math.round(v))}
                onChange={(v) => setS({ ...s, opacity: Math.round(v) / 100 })}
              />
            </div>
          </Panel>
        </div>
        <Panel>
          <PanelHeader
            title={copy.previewTitle}
            hint={fmt(copy.previewHint, { width: String(width) })}
          />
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-medium leading-4 text-fg-muted">
                {copy.previewWidth}
              </span>
              <Segmented
                ariaLabel={copy.previewWidth}
                size="sm"
                value={width}
                onChange={setWidth}
                options={PREVIEW_WIDTHS.map((w) => ({ value: w, label: `${w}px` }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-medium leading-4 text-fg-muted">
                {copy.previewArtwork}
              </span>
              <Segmented
                ariaLabel={copy.previewArtwork}
                size="sm"
                value={tone}
                onChange={setTone}
                options={[
                  { value: 'dark', label: copy.previewDark },
                  { value: 'light', label: copy.previewLight },
                ]}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-medium leading-4 text-fg-muted">
                {copy.previewView}
              </span>
              <Segmented
                ariaLabel={copy.previewView}
                size="sm"
                value={view}
                onChange={setView}
                options={[
                  { value: 'corner', label: copy.previewCorner },
                  { value: 'page', label: copy.previewPage },
                ]}
              />
            </div>
          </div>
          <div
            className={cn(
              'mt-3.5 flex max-h-[60vh] items-start justify-center overflow-auto rounded-[12px] border border-line bg-bg p-3',
              !s.enabled && 'opacity-50',
            )}
          >
            {failed ? (
              <p className="flex items-center gap-2 py-8 text-[13px] text-fg-muted">
                <TriangleAlert size={14} aria-hidden="true" />
                {copy.previewFailed}
              </p>
            ) : (
              <img
                src={previewSrc}
                alt={copy.previewTitle}
                className="h-auto max-w-full"
                onError={() => setFailedSrc(previewSrc)}
              />
            )}
          </div>
          {tone === 'light' ? <Hint className="mt-2">{copy.previewLightHint}</Hint> : null}
        </Panel>
      </div>
      <ReapplyPanel status={status} onStatus={onStatus} canReapply={canReapply} dirty={dirty} />
    </>
  )
}
