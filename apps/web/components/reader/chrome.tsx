'use client'

import { fmt, messages } from '@palscans/core/messages'
import { ChevronDown, ChevronLeft, ChevronRight, MessageSquare, Settings } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ChapterLink } from './types'

export const iconButton =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] text-fg-muted transition-colors hover:bg-white/[.06] hover:text-fg'

const barBase =
  'absolute inset-x-0 z-30 flex items-center border-line bg-bg/95 backdrop-blur-[12px] transition-transform duration-200 motion-reduce:transition-none'

const navButton =
  'inline-flex h-11 items-center gap-1 rounded-[10px] border border-line bg-surface-1 px-3 text-sm font-semibold text-fg transition-colors hover:bg-surface-2 aria-disabled:pointer-events-none aria-disabled:opacity-40'

/* ---------------------------------------------------------------- chapter select */

export interface ChapterSelectProps {
  chapters: ChapterLink[]
  current: number
  className?: string
  /** Pill variant for the floating nav. */
  pill?: boolean
}

/** A native `<select>` (works on every phone) drawn like the mockup's chapter button. */
export function ChapterSelect({ chapters, current, className, pill }: ChapterSelectProps) {
  const router = useRouter()
  return (
    <label
      className={`relative inline-flex h-11 min-w-0 items-center ${
        pill
          ? 'rounded-full border border-white/[.08] bg-white/[.04]'
          : 'rounded-[10px] border border-line bg-surface-1'
      } text-sm font-semibold text-fg transition-colors hover:border-brand-hover ${className ?? ''}`}
    >
      <span className="sr-only">{messages.readerUi.chooseChapter}</span>
      <select
        value={String(current)}
        onChange={(e) => {
          const target = chapters.find((c) => String(c.number) === e.target.value)
          if (target) router.push(target.href)
        }}
        className="h-full w-full cursor-pointer appearance-none bg-transparent pl-4 pr-9 text-fg outline-none focus-visible:outline-2 focus-visible:outline-brand"
      >
        {chapters.map((c) => (
          <option key={c.number} value={String(c.number)} className="bg-surface-1 text-fg">
            {c.locked ? `${c.label} · ${messages.series.premiumOnly}` : c.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={18}
        aria-hidden="true"
        className="pointer-events-none absolute right-3 text-fg-muted"
      />
    </label>
  )
}

/* ---------------------------------------------------------------- page select */

export function PageSelect({
  count,
  current,
  onChange,
  className,
}: {
  count: number
  current: number
  onChange: (idx: number) => void
  className?: string
}) {
  return (
    <label
      className={`relative inline-flex h-8 items-center rounded-md border border-line bg-surface-1 text-[13px] font-semibold text-fg transition-colors hover:border-brand-hover ${className ?? ''}`}
    >
      <span className="sr-only">{messages.readerUi.jumpToPage}</span>
      <select
        value={String(current)}
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10))}
        className="h-full cursor-pointer appearance-none bg-transparent pl-3 pr-8 outline-none focus-visible:outline-2 focus-visible:outline-brand"
      >
        {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
          <option key={n} value={String(n - 1)} className="bg-surface-1 text-fg">
            {fmt(messages.reader.pageOf, { n, total: count })}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 text-fg-muted"
      />
    </label>
  )
}

/* ---------------------------------------------------------------- top bar */

export interface TopBarProps {
  visible: boolean
  paged: boolean
  mobile: boolean
  seriesTitle: string
  seriesHref: string
  chapterLabel: string
  /** "Frost Monarch · Ch. 301" for the compact mobile paged bar. */
  compactLabel: string
  counter: string
  chapters: ChapterLink[]
  currentChapter: number
  pageCount: number
  currentPage: number
  onPage: (idx: number) => void
  onSettings: () => void
  onComments: () => void
  settingsOpen: boolean
  height: number
}

export function TopBar(p: TopBarProps) {
  const back = (
    <Link
      href={p.seriesHref}
      aria-label={fmt(messages.readerUi.backToSeries, { title: p.seriesTitle })}
      className={iconButton}
    >
      <ChevronLeft size={24} aria-hidden="true" />
    </Link>
  )
  const settings = (
    <button
      type="button"
      onClick={p.onSettings}
      aria-label={messages.reader.settings}
      aria-expanded={p.settingsOpen}
      className={`${iconButton} ${p.settingsOpen ? 'bg-brand-wash text-brand-hover' : ''}`}
    >
      <Settings size={24} aria-hidden="true" />
    </button>
  )
  const comments = (
    <button
      type="button"
      onClick={p.onComments}
      aria-label={messages.reader.comments}
      className={iconButton}
    >
      <MessageSquare size={24} aria-hidden="true" />
    </button>
  )
  const cls = `${barBase} top-0 border-b ${p.visible ? 'translate-y-0' : '-translate-y-full'}`

  if (p.paged && p.mobile) {
    return (
      <header className={`${cls} justify-between gap-1 px-1`} style={{ height: p.height }}>
        {back}
        <div className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold tracking-[-0.005em]">
          {p.compactLabel}
        </div>
        {settings}
      </header>
    )
  }
  if (p.paged) {
    return (
      <header className={`${cls} justify-between gap-4 px-3`} style={{ height: p.height }}>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {back}
          <span className="truncate text-sm font-semibold tracking-[-0.005em]">
            {p.seriesTitle}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ChapterSelect
            chapters={p.chapters}
            current={p.currentChapter}
            className="!h-8 text-[13px] [&>select]:pl-3 [&>select]:pr-8"
          />
          <PageSelect count={p.pageCount} current={p.currentPage} onChange={p.onPage} />
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          {comments}
          {settings}
        </div>
      </header>
    )
  }
  return (
    <header className={`${cls} justify-between gap-1.5 px-1 md:px-4`} style={{ height: p.height }}>
      <div className="flex min-w-0 flex-1 items-center gap-0.5 md:gap-2">
        {back}
        <div className="flex min-w-0 flex-col gap-px">
          <div className="truncate text-sm font-semibold leading-[18px]">{p.seriesTitle}</div>
          <div className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium leading-4 text-fg-muted">
            <span>{p.chapterLabel}</span>
            <span className="opacity-55 md:hidden">·</span>
            <span className="tabular-nums md:hidden">{p.counter}</span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 md:gap-1.5">
        <output className="hidden h-8 items-center rounded-md border border-line bg-surface-1 px-3 text-[13px] font-medium tabular-nums tracking-[0.02em] text-fg-muted md:inline-flex">
          {p.counter}
        </output>
        {settings}
        {comments}
      </div>
    </header>
  )
}

/* ---------------------------------------------------------------- bottom bar */

export interface BottomBarProps {
  visible: boolean
  prev: ChapterLink | null
  next: ChapterLink | null
  chapters: ChapterLink[]
  currentChapter: number
  height: number
}

export function BottomBar(p: BottomBarProps) {
  return (
    <nav
      aria-label={messages.reader.nextChapter}
      className={`${barBase} bottom-0 justify-center gap-2 border-t px-2 pb-[env(safe-area-inset-bottom)] md:gap-2.5 md:px-4 ${
        p.visible ? 'translate-y-0' : 'translate-y-full'
      }`}
      style={{ height: `calc(${p.height}px + env(safe-area-inset-bottom))` }}
    >
      <ChapterNavLink link={p.prev} dir="prev" />
      <ChapterSelect
        chapters={p.chapters}
        current={p.currentChapter}
        className="min-w-0 flex-1 md:w-[220px] md:flex-none"
      />
      <ChapterNavLink link={p.next} dir="next" />
    </nav>
  )
}

export function ChapterNavLink({
  link,
  dir,
  pill,
}: {
  link: ChapterLink | null
  dir: 'prev' | 'next'
  pill?: boolean
}) {
  const label = dir === 'prev' ? messages.reader.prev : messages.reader.next
  const title = dir === 'prev' ? messages.reader.prevChapter : messages.reader.nextChapter
  const cls = pill
    ? 'inline-flex h-11 items-center gap-1 rounded-full px-3 text-sm font-semibold text-fg transition-colors hover:bg-white/[.08] aria-disabled:pointer-events-none aria-disabled:opacity-40'
    : navButton
  const inner =
    dir === 'prev' ? (
      <>
        <ChevronLeft size={20} aria-hidden="true" className="text-fg-muted" />
        <span>{label}</span>
      </>
    ) : (
      <>
        <span>{label}</span>
        <ChevronRight size={20} aria-hidden="true" className="text-fg-muted" />
      </>
    )
  if (!link) {
    return (
      <span aria-disabled="true" className={cls}>
        {inner}
      </span>
    )
  }
  return (
    <Link href={link.href} title={title} aria-label={`${title}: ${link.label}`} className={cls}>
      {inner}
    </Link>
  )
}

/* ---------------------------------------------------------------- floating pill */

export function FloatingPill(p: {
  visible: boolean
  prev: ChapterLink | null
  next: ChapterLink | null
  chapters: ChapterLink[]
  currentChapter: number
}) {
  return (
    <nav
      aria-label={messages.reader.nextChapter}
      aria-hidden={!p.visible}
      className={`absolute bottom-[calc(24px+env(safe-area-inset-bottom))] left-1/2 z-30 flex h-14 -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-bg/80 px-1.5 shadow-2 backdrop-blur-[16px] transition-[opacity,transform] duration-200 motion-reduce:transition-none ${
        p.visible ? 'opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
      }`}
    >
      <ChapterNavLink link={p.prev} dir="prev" pill />
      <span aria-hidden="true" className="block h-6 w-px bg-white/[.08]" />
      <ChapterSelect
        chapters={p.chapters}
        current={p.currentChapter}
        pill
        className="w-[170px] md:w-[210px]"
      />
      <span aria-hidden="true" className="block h-6 w-px bg-white/[.08]" />
      <ChapterNavLink link={p.next} dir="next" pill />
    </nav>
  )
}

/* ---------------------------------------------------------------- progress bar */

export function ProgressBar({
  pct,
  top,
  current,
  total,
}: {
  pct: number
  top: number
  current: number
  total: number
}) {
  return (
    <div
      role="progressbar"
      aria-label={messages.readerUi.chapterProgress}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={current}
      className="absolute inset-x-0 z-30 h-[3px] bg-brand-hover/15 transition-[top] duration-200 motion-reduce:transition-none"
      style={{ top }}
    >
      <div
        className="h-full bg-brand-hover shadow-[0_0_8px_rgb(139_92_246_/_0.55)] transition-[width] duration-150 ease-out motion-reduce:transition-none"
        style={{ width: `${Math.round(Math.min(1, Math.max(0, pct)) * 1000) / 10}%` }}
      />
    </div>
  )
}

/* ---------------------------------------------------------------- keyboard hint */

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-line bg-surface-1 px-1 font-body text-xs font-semibold text-fg-muted">
      {children}
    </kbd>
  )
}

export function ChromeHint({ visible }: { visible: boolean }) {
  return (
    <div
      aria-hidden={!visible}
      className={`absolute right-5 top-[15px] z-30 hidden items-center gap-1.5 text-xs font-medium text-fg-muted transition-opacity duration-200 md:flex ${
        visible ? 'opacity-85' : 'pointer-events-none opacity-0'
      }`}
    >
      <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-line bg-bg/95 px-1.5 font-body text-[11px] font-semibold text-fg">
        H
      </kbd>
      <span>· {messages.readerUi.showControls}</span>
    </div>
  )
}
