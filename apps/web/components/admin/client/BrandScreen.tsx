'use client'

import { adminMessages } from '@palscans/core/messages/admin'
import { cn, useToast } from '@palscans/ui'
import { Check, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { IconAsset } from '@/lib/chrome/icons'
import type { LogoPreset } from '@/lib/chrome/presets'
import { splitWordmark } from '@/lib/site'
import { BRAND_SLOTS, type BrandForm, type BrandSlot } from '../schemas-appearance'
import { Field, Hint, inputClass, Panel, PanelHeader, selectClass } from '../ui'
import { api, patchJson, postJson, putJson } from './api'
import { SaveBar } from './controls'
import { sha256Hex, uploadWithRetry } from './upload-lib'

export interface BrandAssetView {
  key: string
  url: string
  width: number
  height: number
  type: string
}

type Assets = Partial<Record<BrandSlot, BrandAssetView | null>>

const ACCEPT = 'image/png,image/jpeg,image/webp,image/avif,image/svg+xml'
const MAX_BYTES = 2 * 1024 * 1024

/**
 * One of the ten marks, drawn at a given size. The markup is generated from the SVGs in
 * `design/logos/` by `design/logos/emit-preset-art.mjs` and reaches this screen as a prop from
 * the server — it is never operator input, which is what makes inlining it safe.
 */
function PresetGlyph({ svg, size }: { svg: string; size: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0"
      style={{ width: size, height: size }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: build-time SVG from design/logos, passed from the server; never operator input
      dangerouslySetInnerHTML={{ __html: svg.replace('<svg', '<svg width="100%" height="100%"') }}
    />
  )
}

/**
 * A card in the gallery: the mark on the dark ground, the same mark on white, and the 16px
 * reduction beside them — the three views that actually decide whether a logo works, and the
 * ones a list of filenames hides.
 */
function PresetCard({
  preset,
  selected,
  onSelect,
}: {
  preset: PresetView
  selected: boolean
  onSelect: () => void
}) {
  const m = adminMessages.brand
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      title={preset.note}
      className={cn(
        'flex h-full w-full flex-col gap-2 rounded-lg border p-3 text-left transition-colors',
        selected ? 'border-brand bg-brand-wash' : 'border-line bg-bg hover:border-fg-subtle',
      )}
    >
      <span className="flex items-center gap-2">
        <span className="grid size-[52px] shrink-0 place-items-center rounded-md bg-[#100d17]">
          <PresetGlyph svg={preset.svg} size={40} />
        </span>
        <span className="grid size-[52px] shrink-0 place-items-center rounded-md border border-line-soft bg-white">
          <PresetGlyph svg={preset.svg} size={40} />
        </span>
        <span className="flex flex-col items-center gap-1">
          <PresetGlyph svg={preset.svg} size={16} />
          <span className="text-[10px] leading-none text-fg-subtle">16px</span>
        </span>
      </span>
      <span className="flex items-center gap-1.5 text-[13px] font-semibold">
        {preset.name}
        {selected ? <Check size={14} aria-hidden="true" className="text-brand-hover" /> : null}
        <span className="sr-only">{selected ? m.selected : ''}</span>
      </span>
    </button>
  )
}

export interface PresetView extends LogoPreset {
  svg: string
}

/**
 * Appearance → Brand (docs/15).
 *
 * The text fields and the logo choice save together through the SaveBar; an upload is its own
 * transaction and lands the moment it is confirmed. That split is deliberate — an operator who
 * drops a logo in and navigates away should still have the logo, and a half-finished rename
 * should not take an upload with it.
 */
export function BrandScreen({
  initial,
  presets,
  assets: initialAssets,
  icons,
}: {
  initial: BrandForm
  presets: readonly PresetView[]
  assets: Assets
  icons: {
    version: string
    sizes: Array<{ asset: IconAsset; href: string }>
    social: string
  } | null
}) {
  const m = adminMessages.brand
  const router = useRouter()
  const { toast } = useToast()
  const [saved, setSaved] = useState(initial)
  const [s, setS] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [assets, setAssets] = useState<Assets>(initialAssets)
  const dirty = JSON.stringify(s) !== JSON.stringify(saved)
  const [lead, rest] = splitWordmark(s.name)
  const logo = assets.logo_dark ?? assets.logo_light ?? null
  const chosen = presets.find((p) => p.id === s.logo_preset) ?? null

  return (
    <div className="flex flex-col gap-3.5">
      <SaveBar
        dirty={dirty}
        saving={saving}
        onDiscard={() => setS(saved)}
        onSave={async () => {
          setSaving(true)
          const res = await putJson<BrandForm>('/api/admin/appearance/brand', s)
          setSaving(false)
          if (!res.ok)
            return toast({
              title: adminMessages.admin.errorSaving,
              description: res.message,
              tone: 'danger',
            })
          setSaved(res.data)
          setS(res.data)
          // The generated icons are server-rendered and their URLs carry a version derived
          // from the mark and the background: without this the previews below would still be
          // the ones from before the save.
          router.refresh()
          toast({ title: m.saved, tone: 'ok' })
        }}
      />

      <div className="grid gap-3.5 lg:grid-cols-2">
        <Panel>
          <PanelHeader title={m.identity} hint={m.identityHint} />
          <div className="flex flex-col gap-3">
            <Field label={m.siteName} htmlFor="br-name">
              <input
                id="br-name"
                className={inputClass}
                value={s.name}
                maxLength={60}
                onChange={(e) => setS({ ...s, name: e.target.value })}
              />
            </Field>
            <Field label={m.tagline} hint={m.taglineHint} htmlFor="br-tag">
              <input
                id="br-tag"
                className={inputClass}
                value={s.tagline}
                maxLength={200}
                onChange={(e) => setS({ ...s, tagline: e.target.value })}
              />
            </Field>
            <Field label={m.wordmark} hint={m.wordmarkHint} htmlFor="br-wm">
              <select
                id="br-wm"
                className={selectClass}
                value={s.wordmark}
                onChange={(e) => setS({ ...s, wordmark: e.target.value as BrandForm['wordmark'] })}
              >
                {(['logo', 'logo+name', 'name'] as const).map((v) => (
                  <option key={v} value={v}>
                    {m.wordmarkStyles[v]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title={m.preview} hint={m.previewHint} />
          {/*
            Both grounds, because a mark that reads on one can vanish on the other. The two
            colours are written out rather than taken from the tokens: this panel renders
            inside the admin's own theme, and the point is to show the *other* one too.
          */}
          {(
            [
              { ground: '#100d17', ink: '#ece9f4' },
              { ground: '#ffffff', ink: '#201a2e' },
            ] as const
          ).map(({ ground, ink }) => (
            <div
              key={ground}
              style={{ background: ground, color: ink }}
              className="mb-2 flex h-[64px] items-center gap-2.5 rounded-lg border border-line px-4 last:mb-0"
            >
              {s.wordmark !== 'name' ? (
                chosen ? (
                  <PresetGlyph svg={chosen.svg} size={30} />
                ) : logo ? (
                  <img
                    src={logo.url}
                    alt=""
                    className="h-[30px] w-auto object-contain"
                    style={{ maxWidth: 220 }}
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="grid size-[30px] shrink-0 place-items-center rounded-[7px] bg-brand font-display text-[15px] font-extrabold text-brand-ink"
                  >
                    {(s.name.trim()[0] ?? '?').toUpperCase()}
                  </span>
                )
              ) : null}
              {s.wordmark !== 'logo' ? (
                <span className="font-display text-[21px] font-extrabold leading-none tracking-[-0.04em]">
                  {lead}
                  {rest ? <span className="font-normal tracking-[-0.02em]">{rest}</span> : null}
                </span>
              ) : null}
            </div>
          ))}
          <Hint className="mt-2">{m.wordmarkHint}</Hint>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title={m.pick} hint={m.pickHint} />
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {presets.map((preset) => (
            <li key={preset.id}>
              <PresetCard
                preset={preset}
                selected={s.logo_preset === preset.id}
                onSelect={() => setS({ ...s, logo_preset: preset.id })}
              />
            </li>
          ))}
          <li>
            {/*
              The eleventh option. It is not a separate setting: clearing the preset falls back
              to whatever is uploaded below, and the upload survives a trip through the presets.
            */}
            <button
              type="button"
              aria-pressed={s.logo_preset === null}
              onClick={() => setS({ ...s, logo_preset: null })}
              className={cn(
                'flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg border p-3 text-center transition-colors',
                s.logo_preset === null
                  ? 'border-brand bg-brand-wash'
                  : 'border-line bg-bg hover:border-fg-subtle',
              )}
            >
              <span className="grid size-[52px] place-items-center rounded-md border border-dashed border-line-soft">
                <Upload size={20} aria-hidden="true" className="text-fg-muted" />
              </span>
              <span className="text-[13px] font-semibold">{m.useMyOwn}</span>
              <span className="text-[11.5px] leading-4 text-fg-subtle">{m.useMyOwnHint}</span>
            </button>
          </li>
        </ul>
        {chosen ? <Hint className="mt-3">{chosen.note}</Hint> : null}
      </Panel>

      <Panel>
        <PanelHeader title={m.uploads} hint={m.uploadsHint} />
        <div className="grid gap-3 md:grid-cols-2">
          {BRAND_SLOTS.map((slot) => (
            <AssetDrop
              key={slot}
              slot={slot}
              asset={assets[slot] ?? null}
              onChange={(next) => setAssets((a) => ({ ...a, [slot]: next }))}
            />
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title={m.icons} hint={m.iconsHint} />
        <div className="flex flex-col gap-3">
          <Field label={m.monogramBg} hint={m.monogramBgHint} htmlFor="br-bg">
            <div className="flex items-center gap-2">
              <input
                id="br-bg"
                type="color"
                aria-label={m.monogramBg}
                className="size-9 shrink-0 cursor-pointer rounded-md border border-line bg-bg"
                value={s.monogram_bg}
                onChange={(e) => setS({ ...s, monogram_bg: e.target.value })}
              />
              <input
                className={cn(inputClass, 'max-w-[140px] font-mono')}
                value={s.monogram_bg}
                aria-label={m.monogramBg}
                onChange={(e) => setS({ ...s, monogram_bg: e.target.value })}
              />
            </div>
          </Field>
          {icons && (s.logo_preset || assets.monogram) ? (
            <ul className="flex flex-wrap items-end gap-4">
              {icons.sizes.map((i) => (
                <li key={i.asset} className="flex flex-col items-center gap-1.5">
                  <img
                    src={i.href}
                    alt={i.asset}
                    width={64}
                    height={64}
                    className="size-16 rounded-md border border-line bg-surface-2 object-contain"
                  />
                  <span className="font-mono text-[11px] text-fg-subtle">{i.asset}</span>
                </li>
              ))}
              <li className="flex flex-col items-center gap-1.5">
                <img
                  src={icons.social}
                  alt={m.slots.social_image}
                  width={160}
                  height={84}
                  className="h-[84px] w-[160px] rounded-md border border-line object-contain"
                />
                <span className="font-mono text-[11px] text-fg-subtle">1200×630</span>
              </li>
            </ul>
          ) : (
            <Hint>{m.iconsDefault}</Hint>
          )}
        </div>
      </Panel>
    </div>
  )
}

function AssetDrop({
  slot,
  asset,
  onChange,
}: {
  slot: BrandSlot
  asset: BrandAssetView | null
  onChange: (next: BrandAssetView | null) => void
}) {
  const m = adminMessages.brand
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const inputId = `brand-${slot}`

  const handle = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_BYTES) return toast({ title: m.tooLarge, tone: 'danger' })
    setBusy(true)
    try {
      const sha256 = await sha256Hex(file)
      const intent = await postJson<{
        key: string
        url: string
        method: 'PUT'
        headers: Record<string, string>
      }>('/api/admin/appearance/brand/asset', {
        slot,
        name: file.name,
        bytes: file.size,
        sha256,
        // Some browsers hand back an empty type for .svg dropped from a file manager.
        type: file.type || (file.name.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : ''),
      })
      if (!intent.ok) throw new Error(intent.message || intent.error)
      await uploadWithRetry(intent.data.url, intent.data.headers, file)
      const confirm = await patchJson<{ slot: BrandSlot; asset: BrandAssetView }>(
        '/api/admin/appearance/brand/asset',
        { slot, key: intent.data.key },
      )
      if (!confirm.ok)
        throw new Error(
          confirm.error === 'unsafe_svg'
            ? m.unsafeSvg
            : confirm.error === 'unsupported_type'
              ? m.unsupported
              : confirm.message || confirm.error,
        )
      onChange(confirm.data.asset)
      toast({ title: adminMessages.admin.saved, tone: 'ok' })
    } catch (err) {
      toast({
        title: adminMessages.admin.errorSaving,
        description: err instanceof Error ? err.message : '',
        tone: 'danger',
      })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    const res = await api('/api/admin/appearance/brand/asset', {
      method: 'DELETE',
      body: JSON.stringify({ slot }),
    })
    setBusy(false)
    if (!res.ok) return toast({ title: adminMessages.admin.errorSaving, tone: 'danger' })
    onChange(null)
  }

  return (
    <div className="rounded-lg border border-line bg-bg p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold">{m.slots[slot]}</div>
          <p className="text-[12px] leading-4 text-fg-subtle">{m.slotHints[slot]}</p>
        </div>
        {asset ? (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            className="shrink-0 text-[12px] font-semibold text-fg-muted underline-offset-2 hover:text-danger hover:underline disabled:opacity-50"
          >
            {m.removeAsset}
          </button>
        ) : null}
      </div>
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          void handle(e.dataTransfer.files[0])
        }}
        className={cn(
          'flex min-h-[104px] cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed p-3 text-center text-[12.5px] text-fg-muted transition-colors',
          drag ? 'border-brand bg-brand-wash' : 'border-line hover:border-fg-subtle',
        )}
      >
        {asset ? (
          <img
            src={asset.url}
            alt=""
            className={cn(
              'max-h-[64px] max-w-full object-contain',
              // A pale logo on the panel's own background would be invisible; the checker
              // makes transparency visible without guessing at the reader's theme.
              slot === 'logo_light' ? 'bg-white p-1' : undefined,
            )}
          />
        ) : null}
        <span>{busy ? m.uploading : asset ? m.replace : m.dropImage}</span>
        {asset ? (
          <span className="font-mono text-[11px] text-fg-subtle">
            {asset.width}×{asset.height}
          </span>
        ) : (
          <span className="text-[11px] text-fg-subtle">{m.noAsset}</span>
        )}
        <input
          id={inputId}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => void handle(e.target.files?.[0])}
        />
      </label>
    </div>
  )
}
