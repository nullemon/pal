/** biome-ignore-all lint/suspicious/noArrayIndexKey: the strip preview is a static illustration */
'use client'

import { messages } from '@palscans/core/messages'
import { cn, useToast } from '@palscans/ui'
import { ExternalLink, Info, Rows3, ScrollText } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  BUILT_LAYOUTS,
  DIRECTIONS,
  type Direction,
  type LayoutsSetting,
} from '../schemas-appearance'
import { Eyebrow, Hint, PageHeader, Panel, PanelHeader, selectClass } from '../ui'
import { putJson } from './api'
import { SaveBar, Segmented, Toggle } from './controls'
import { LayoutThumb } from './LayoutThumbs'
import { formatChapterNumber } from './util'

const copy = messages.admin.layouts
const common = messages.admin

function RadioCard({
  direction,
  name,
  selected,
  live,
  built,
  previewHref,
  onSelect,
}: {
  direction: Direction
  name: string
  selected: boolean
  live: boolean
  built: boolean
  previewHref: string
  onSelect: () => void
}) {
  return (
    <div
      className={cn(
        'relative flex flex-col items-center gap-2 rounded-[12px] border bg-bg p-2 transition-colors',
        selected ? 'border-brand-hover shadow-[0_0_0_2px_rgb(139_92_246_/_0.45)]' : 'border-line',
        built ? 'hover:border-fg-subtle' : 'opacity-60',
      )}
    >
      <button
        type="button"
        disabled={!built}
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`${direction} · ${name}`}
        className="relative block disabled:cursor-not-allowed"
      >
        <LayoutThumb direction={direction} />
        {live ? (
          <span className="absolute top-1.5 right-1.5 flex h-[18px] items-center rounded-full bg-brand-hover px-[7px] text-[10px] font-bold uppercase tracking-[0.08em] text-white">
            {common.live}
          </span>
        ) : null}
        {!built ? (
          <span className="absolute top-1.5 right-1.5 flex h-[18px] items-center rounded-full bg-surface-3 px-[7px] text-[10px] font-bold uppercase tracking-[0.08em] text-fg-muted">
            {common.notBuilt}
          </span>
        ) : null}
      </button>
      <div className="flex w-[150px] flex-col gap-[3px]">
        <button
          type="button"
          disabled={!built}
          onClick={onSelect}
          className="flex h-[18px] items-center gap-2 text-left disabled:cursor-not-allowed"
        >
          <span
            className={cn(
              'size-4 shrink-0 rounded-full',
              selected
                ? 'bg-brand-hover shadow-[inset_0_0_0_3px_var(--color-bg),0_0_0_1.5px_var(--color-brand-hover)]'
                : 'border-[1.5px] border-surface-3',
            )}
          />
          <span className="text-[11px] font-bold text-fg-muted">{direction}</span>
          <span className="whitespace-nowrap text-[13px] font-semibold">{name}</span>
        </button>
        {built ? (
          <a
            href={previewHref}
            target="_blank"
            rel="noreferrer"
            className="ml-6 inline-flex items-center gap-1 text-[12px] font-medium text-brand-hover hover:underline"
          >
            {common.preview}
            <ExternalLink size={11} aria-hidden="true" />
          </a>
        ) : (
          <span className="ml-6 text-[12px] text-fg-subtle">{common.notBuilt}</span>
        )}
      </div>
    </div>
  )
}

/** Appearance → Layouts, per design/mockups/admin/AdminLayouts.dc.html. */
export function LayoutsScreen({
  initial,
  sample,
}: {
  initial: LayoutsSetting
  sample: { slug: string; number: number; title: string } | null
}) {
  const { toast } = useToast()
  const [saved, setSaved] = useState(initial)
  const [s, setS] = useState(initial)
  const [saving, setSaving] = useState(false)
  const dirty = useMemo(() => JSON.stringify(s) !== JSON.stringify(saved), [s, saved])
  const names = copy.directions
  const readerHref = sample
    ? `/series/${sample.slug}/chapter-${formatChapterNumber(sample.number)}`
    : '/'

  const save = async () => {
    setSaving(true)
    const res = await putJson<LayoutsSetting>('/api/admin/appearance/layouts', s)
    setSaving(false)
    if (!res.ok)
      return toast({ title: common.errorSaving, description: res.message, tone: 'danger' })
    setSaved(res.data)
    toast({ title: copy.saved, tone: 'ok' })
  }

  const row = (kind: 'home' | 'series', title: string, hint: string, previewBase: string) => (
    <Panel>
      <PanelHeader
        title={title}
        hint={hint}
        aside={
          <>
            <span>{common.liveNow}</span>
            <span className="font-semibold text-fg">
              {saved[kind]} · {names[saved[kind]]}
            </span>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-6">
        {DIRECTIONS.map((d) => (
          <RadioCard
            key={d}
            direction={d}
            name={names[d]}
            selected={s[kind] === d}
            live={saved[kind] === d}
            built={BUILT_LAYOUTS[kind].includes(d)}
            previewHref={`${previewBase}?layout=${d}`}
            onSelect={() => setS({ ...s, [kind]: d })}
          />
        ))}
      </div>
    </Panel>
  )

  const interval = s.ads.mobile_interval
  const stripPages = 8
  return (
    <>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => setS(saved)} />
      <PageHeader title={copy.title} subtitle={copy.subtitle} />
      {row('home', copy.homeTitle, copy.homeHint, '/')}
      {row('series', copy.seriesTitle, copy.seriesHint, sample ? `/series/${sample.slug}` : '/')}
      <Panel>
        <PanelHeader
          title={copy.readerTitle}
          hint={copy.readerHint}
          aside={
            <a
              href={readerHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-medium text-brand-hover hover:underline"
            >
              {copy.openReader.replace('{n}', sample ? formatChapterNumber(sample.number) : '1')}
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          }
        />
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <div className="flex flex-col gap-2">
            <Eyebrow>{copy.defaultMode}</Eyebrow>
            <Segmented
              ariaLabel={copy.defaultMode}
              value={s.reader.default_mode}
              onChange={(v) => setS({ ...s, reader: { default_mode: v } })}
              options={[
                {
                  value: 'strip',
                  label: (
                    <>
                      <ScrollText size={14} aria-hidden="true" />
                      {copy.strip}
                    </>
                  ),
                },
                {
                  value: 'paged',
                  label: (
                    <>
                      <Rows3 size={14} aria-hidden="true" />
                      {copy.paged}
                    </>
                  ),
                },
              ]}
            />
            <Hint>{copy.modeHint}</Hint>
          </div>
          <div className="flex flex-col gap-2">
            <Eyebrow>{copy.skyscrapers}</Eyebrow>
            <div className="flex h-10 items-center gap-3">
              <Toggle
                checked={s.ads.skyscrapers}
                onChange={(v) => setS({ ...s, ads: { ...s.ads, skyscrapers: v } })}
                label={copy.skyscrapers}
              />
              <select
                aria-label={copy.skyscrapers}
                className={`${selectClass} ml-auto h-10 w-auto rounded-[10px] tabular-nums`}
                value={s.ads.sky_size}
                disabled={!s.ads.skyscrapers}
                onChange={(e) =>
                  setS({
                    ...s,
                    ads: { ...s.ads, sky_size: e.target.value as '160x600' | '300x600' },
                  })
                }
              >
                <option value="160x600">160×600</option>
                <option value="300x600">300×600</option>
              </select>
            </div>
            <Hint>{copy.skyscrapersHint}</Hint>
          </div>
          <div className="flex flex-col gap-2">
            <Eyebrow>{copy.interval}</Eyebrow>
            <div className="flex h-10 items-center gap-2.5">
              <Segmented
                ariaLabel={copy.interval}
                value={interval}
                onChange={(v) => setS({ ...s, ads: { ...s.ads, mobile_interval: v } })}
                options={[
                  { value: 0, label: common.off },
                  { value: 2, label: '2' },
                  { value: 4, label: '4' },
                  { value: 6, label: '6' },
                ]}
              />
              <span className="text-[13px] text-fg-muted">{copy.intervalPages}</span>
            </div>
            <Hint>{copy.intervalHint}</Hint>
            <div className="mt-1 rounded-md border border-line bg-bg p-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-fg-subtle">
                {copy.stripPreview}
              </div>
              <div className="flex flex-col gap-px">
                {Array.from({ length: stripPages }, (_, i) => (
                  <div key={`p${i}`} className="contents">
                    <div className="flex h-3 items-center justify-center rounded-[2px] bg-surface-3 text-[8px] text-fg-subtle">
                      {copy.stripPage.replace('{n}', String(i + 1))}
                    </div>
                    {interval > 0 && (i + 1) % interval === 0 && i + 1 < stripPages ? (
                      <div className="flex h-4 items-center justify-center rounded-[2px] bg-bg-deep text-[8px] font-bold uppercase tracking-[0.08em] text-brand-hover shadow-[inset_0_0_0_1px_var(--color-brand-dim)]">
                        {copy.stripAd} 300×250
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Eyebrow>{copy.endSlot}</Eyebrow>
            <div className="flex h-10 items-center gap-3">
              <Toggle
                checked={s.ads.end_slot}
                onChange={(v) => setS({ ...s, ads: { ...s.ads, end_slot: v } })}
                label={copy.endSlot}
              />
            </div>
            <Hint>{copy.endSlotHint}</Hint>
          </div>
        </div>
      </Panel>
      <div className="flex items-center gap-2 px-0.5 text-[12.5px] leading-[18px] text-fg-muted">
        <Info size={14} aria-hidden="true" />
        {common.cachePurged}
      </div>
    </>
  )
}
