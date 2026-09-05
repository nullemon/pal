'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Sheet } from '@palscans/ui'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Crown,
  Flag,
  Keyboard,
  RectangleVertical,
  Rows3,
} from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useId } from 'react'
import { Kbd } from './chrome'
import type { ReaderBackground, ReaderSettings } from './types'

interface Option<T extends string | number> {
  value: T
  label: string
  icon?: ReactNode
}

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  tall,
}: {
  label: string
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
  tall?: boolean
}) {
  const name = useId()
  return (
    <fieldset
      className={`flex min-w-0 flex-1 gap-0.5 rounded-[12px] border border-line bg-bg-deep p-0.5 ${tall ? 'h-[66px]' : 'h-[50px]'}`}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((o) => {
        const on = o.value === value
        return (
          <label
            key={String(o.value)}
            className={`flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand ${
              tall ? 'h-[60px] flex-col gap-1' : 'h-11'
            } ${on ? 'bg-surface-3 font-semibold text-fg shadow-1 [&_svg]:text-brand-hover' : 'font-medium text-fg-muted hover:bg-white/[.05] hover:text-fg'}`}
          >
            <input
              type="radio"
              name={name}
              value={String(o.value)}
              checked={on}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.icon}
            <span>{o.label}</span>
          </label>
        )
      })}
    </fieldset>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-16 items-center gap-3 border-t border-white/[.06]">
      <div className="w-[92px] shrink-0 text-sm font-semibold">{label}</div>
      {children}
    </div>
  )
}

const swatches: Array<{ value: ReaderBackground; label: string; color: string; light: boolean }> = [
  {
    value: 'black',
    label: messages.reader.backgroundBlack,
    color: 'var(--color-reader-black)',
    light: false,
  },
  {
    value: 'dark',
    label: messages.reader.backgroundDark,
    color: 'var(--color-reader-dark)',
    light: false,
  },
  {
    value: 'sepia',
    label: messages.reader.backgroundSepia,
    color: 'var(--color-reader-sepia)',
    light: true,
  },
  {
    value: 'white',
    label: messages.reader.backgroundWhite,
    color: 'var(--color-reader-white)',
    light: true,
  },
]

export interface SettingsSheetProps {
  open: boolean
  onClose: () => void
  settings: ReaderSettings
  update: (patch: Partial<ReaderSettings>) => void
  subscribeHref: string
  /** Hide the Premium row for readers who already have `no_ads`. */
  showPremium: boolean
}

/** docs/06 "Settings sheet" — mode · direction · fit · quality · preload · background · gap · Go Premium. */
export function SettingsSheet({
  open,
  onClose,
  settings,
  update,
  subscribeHref,
  showPremium,
}: SettingsSheetProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={messages.reader.settings}
      className="md:w-[min(520px,calc(100vw-2rem))]"
    >
      <div className="flex flex-col">
        <div className="-mt-2 flex justify-end md:hidden">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-[10px] px-2 text-sm font-semibold text-brand-hover"
          >
            {messages.readerUi.done}
          </button>
        </div>
        <div className="mt-2.5 flex flex-col gap-2">
          <div className="text-sm font-semibold">{messages.reader.mode}</div>
          <Segmented
            tall
            label={messages.reader.mode}
            value={settings.mode}
            onChange={(mode) => update({ mode })}
            options={[
              {
                value: 'strip',
                label: messages.reader.modeStrip,
                icon: <Rows3 size={22} aria-hidden="true" />,
              },
              {
                value: 'single',
                label: messages.readerUi.modeSingle,
                icon: <RectangleVertical size={22} aria-hidden="true" />,
              },
              {
                value: 'double',
                label: messages.readerUi.modeDouble,
                icon: <BookOpen size={22} aria-hidden="true" />,
              },
            ]}
          />
        </div>
        <div className="mt-3.5 flex flex-col">
          <Row label={messages.reader.direction}>
            <Segmented
              label={messages.reader.direction}
              value={settings.direction}
              onChange={(direction) => update({ direction })}
              options={[
                {
                  value: 'ltr',
                  label: messages.reader.directionLtr,
                  icon: <ArrowRight size={16} aria-hidden="true" />,
                },
                {
                  value: 'rtl',
                  label: messages.reader.directionRtl,
                  icon: <ArrowLeft size={16} aria-hidden="true" />,
                },
              ]}
            />
          </Row>
          <Row label={messages.reader.fit}>
            <Segmented
              label={messages.reader.fit}
              value={settings.fit}
              onChange={(fit) => update({ fit })}
              options={[
                { value: 'width', label: messages.readerUi.fitWidthShort },
                { value: 'height', label: messages.readerUi.fitHeightShort },
                { value: 'original', label: messages.reader.fitOriginal },
              ]}
            />
          </Row>
          <Row label={messages.reader.quality}>
            <Segmented
              label={messages.reader.quality}
              value={settings.quality}
              onChange={(quality) => update({ quality })}
              options={[
                { value: 'auto', label: messages.reader.qualityAuto },
                { value: 'high', label: messages.reader.qualityHigh },
                { value: 'saver', label: messages.reader.qualitySaver },
              ]}
            />
          </Row>
          <Row label={messages.reader.preload}>
            <Segmented
              label={messages.reader.preload}
              value={settings.preload}
              onChange={(preload) => update({ preload })}
              options={[
                { value: 3, label: fmt(messages.readerUi.preloadPages, { n: 3 }) },
                { value: 5, label: fmt(messages.readerUi.preloadPages, { n: 5 }) },
                { value: 10, label: fmt(messages.readerUi.preloadPages, { n: 10 }) },
              ]}
            />
          </Row>
          <Row label={messages.reader.background}>
            <fieldset className="flex flex-1 items-center gap-3.5">
              <legend className="sr-only">{messages.reader.background}</legend>
              {swatches.map((s) => {
                const on = settings.background === s.value
                return (
                  <label
                    key={s.value}
                    title={s.label}
                    className={`size-11 cursor-pointer rounded-full border transition-transform hover:scale-105 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand ${
                      s.light ? 'border-black/15' : 'border-line'
                    } ${on ? 'shadow-[0_0_0_2px_var(--color-surface-2),0_0_0_4px_var(--color-brand-hover)]' : ''}`}
                    style={{ background: s.color }}
                  >
                    <input
                      type="radio"
                      name="reader-background"
                      value={s.value}
                      checked={on}
                      onChange={() => update({ background: s.value })}
                      aria-label={s.label}
                      className="sr-only"
                    />
                  </label>
                )
              })}
            </fieldset>
          </Row>
          <Row label={messages.readerUi.gap}>
            <Segmented
              label={messages.readerUi.gap}
              value={settings.gap}
              onChange={(gap) => update({ gap })}
              options={[
                { value: 0, label: messages.readerUi.gapNone },
                { value: 8, label: messages.readerUi.gapSmall },
                { value: 16, label: messages.readerUi.gapLarge },
              ]}
            />
          </Row>
        </div>
        {showPremium ? (
          <div className="mt-3.5 flex items-center gap-3 border-t border-white/[.06] pt-3.5">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-gold/[.12] text-gold">
              <Crown size={22} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 text-sm font-medium leading-[18px]">
              {messages.readerUi.premiumRow}
            </div>
            <Link
              href={subscribeHref}
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-[12px] bg-brand-hover px-4 text-sm font-bold text-brand-ink transition-colors hover:bg-brand"
            >
              {messages.reader.goPremium}
            </Link>
          </div>
        ) : null}
      </div>
    </Sheet>
  )
}

const shortcuts: Array<{ keys: string[]; label: string }> = [
  { keys: ['←', '→'], label: messages.readerUi.shortcutTurn },
  { keys: ['Space', 'Shift + Space'], label: messages.readerUi.shortcutScroll },
  { keys: ['F'], label: messages.readerUi.shortcutFullscreen },
  { keys: ['S'], label: messages.readerUi.shortcutMode },
  { keys: ['C'], label: messages.readerUi.shortcutComments },
  { keys: ['H'], label: messages.readerUi.shortcutChrome },
  { keys: ['?'], label: messages.readerUi.shortcutSheet },
]

export function ShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={messages.readerUi.shortcutsTitle}>
      <dl className="flex flex-col divide-y divide-white/[.06]">
        {shortcuts.map((s) => (
          <div key={s.label} className="flex min-h-11 items-center justify-between gap-4 py-2">
            <dt className="text-sm text-fg">{s.label}</dt>
            <dd className="flex items-center gap-1">
              {s.keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Sheet>
  )
}

/* ---------------------------------------------------------------- overflow menu */

/**
 * The reader's "…" menu. Everything that is neither navigation nor a setting: the shortcuts
 * card, and "Report an issue" — put here rather than behind the end-of-chapter card because
 * a reader who has found a missing page has, by definition, not reached the end.
 */
export function MoreSheet({
  open,
  onClose,
  onReport,
  onShortcuts,
  showShortcuts,
}: {
  open: boolean
  onClose: () => void
  onReport: () => void
  onShortcuts: () => void
  /** Hidden on touch, where there is no keyboard to have shortcuts for. */
  showShortcuts: boolean
}) {
  const item =
    'flex min-h-12 w-full items-center gap-3 rounded-[10px] px-3 text-left text-sm font-semibold text-fg transition-colors hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-brand'
  return (
    <Sheet open={open} onClose={onClose} title={messages.chapterReport.menu}>
      <div className="flex flex-col gap-1">
        <button type="button" className={item} onClick={onReport}>
          <Flag size={20} aria-hidden="true" className="text-fg-muted" />
          <span>{messages.chapterReport.open}</span>
        </button>
        {showShortcuts ? (
          <button type="button" className={item} onClick={onShortcuts}>
            <Keyboard size={20} aria-hidden="true" className="text-fg-muted" />
            <span>{messages.readerUi.shortcutsTitle}</span>
          </button>
        ) : null}
      </div>
    </Sheet>
  )
}
