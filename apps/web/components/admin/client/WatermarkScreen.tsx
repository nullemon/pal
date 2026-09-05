'use client'

import { fmt, messages } from '@palscans/core/messages'
import { WATERMARK_CORNERS, WATERMARK_LIMITS, type WatermarkConfig } from '@palscans/core/watermark'
import { cn, useToast } from '@palscans/ui'
import { ExternalLink, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Field, Hint, inputClass, PageHeader, Panel, PanelHeader } from '../ui'
import { putJson } from './api'
import { SaveBar, Segmented, Toggle } from './controls'

const copy = messages.admin.watermark
const common = messages.admin

const PREVIEW_WIDTHS = [480, 720, 1080, 1440] as const

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
}: {
  initial: WatermarkConfig
  fontAvailable: boolean
}) {
  const { toast } = useToast()
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
    toast({ title: copy.saved, tone: 'ok' })
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
          <Panel>
            <PanelHeader title={copy.applyTitle} />
            <Hint>{copy.applyBody}</Hint>
            <a
              href="/admin/chapters"
              className="mt-2.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-hover hover:underline"
            >
              {copy.openChapters}
              <ExternalLink size={12} aria-hidden="true" />
            </a>
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
    </>
  )
}
