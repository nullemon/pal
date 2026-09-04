import { fmt, messages } from '@palscans/core/messages'
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react'
import Link from 'next/link'
import type { ChapterLink } from './types'
import { UnlockCountdown } from './UnlockCountdown'

export interface LockedGateProps {
  seriesTitle: string
  seriesHref: string
  coverUrl: string | null
  coverColor: string | null
  chapterLabel: string
  lock: 'early_access' | 'premium' | 'unpublished'
  /** ISO time the early-access window ends. */
  freeAt: string | null
  now: Date
  prev: ChapterLink | null
  next: ChapterLink | null
  signedIn: boolean
  subscribeHref: string
  signInHref: string
}

/**
 * docs/06 "Locked chapters": the subscribe gate carrying series, cover and chapter. Server
 * rendered and — the whole point — not one page URL in the HTML. The only client code is the
 * early-access countdown, which is handed a deadline and nothing else.
 */
export function LockedGate(p: LockedGateProps) {
  const body =
    p.lock === 'early_access' && p.freeAt
      ? messages.readerUi.lockedEarlyAccessHint
      : p.lock === 'unpublished'
        ? messages.readerUi.lockedUnpublished
        : messages.reader.lockedPremium
  const nav =
    'inline-flex h-11 items-center gap-1 rounded-[10px] border border-line bg-surface-1 px-3 text-sm font-semibold text-fg transition-colors hover:bg-surface-2 aria-disabled:pointer-events-none aria-disabled:opacity-40'
  return (
    <div
      id="reader-root"
      data-locked
      className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-bg-deep text-fg"
    >
      <style>
        {
          'html:has(#reader-root){overflow:hidden;scrollbar-gutter:auto}body:has(#reader-root)>header,body:has(#reader-root)>footer,body:has(#reader-root)>nav{display:none}'
        }
      </style>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-bg/95 px-1 md:px-4">
        <Link
          href={p.seriesHref}
          aria-label={fmt(messages.readerUi.backToSeries, { title: p.seriesTitle })}
          className="inline-flex size-11 items-center justify-center rounded-[10px] text-fg-muted hover:bg-white/[.06] hover:text-fg"
        >
          <ChevronLeft size={24} aria-hidden="true" />
        </Link>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-[18px]">{p.seriesTitle}</div>
          <div className="text-xs font-medium text-fg-muted">{p.chapterLabel}</div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <section
          aria-labelledby="locked-title"
          className="flex w-full max-w-[560px] flex-col items-center gap-5 rounded-lg border border-line bg-surface-1 p-6 text-center shadow-2 md:flex-row md:items-start md:text-left"
        >
          <div
            className="w-[140px] shrink-0 overflow-hidden rounded-md bg-surface-3 shadow-1"
            style={{ aspectRatio: '2 / 3', background: p.coverColor ?? undefined }}
          >
            {p.coverUrl ? (
              <img
                src={p.coverUrl}
                alt={fmt(messages.seriesDetail.coverAlt, { title: p.seriesTitle })}
                width={400}
                height={600}
                loading="eager"
                fetchPriority="high"
                className="size-full object-cover"
              />
            ) : null}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <span className="inline-flex items-center gap-1.5 self-center rounded-full bg-gold/[.12] px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-gold md:self-start">
              <Lock size={14} aria-hidden="true" />
              {p.lock === 'early_access'
                ? messages.series.earlyAccess
                : messages.series.premiumOnly}
            </span>
            <h1 id="locked-title" className="text-xl font-extrabold">
              {messages.reader.lockedTitle}
            </h1>
            <p className="text-sm text-fg-muted">
              {body}
              {p.lock === 'early_access' && p.freeAt ? (
                <>
                  {' '}
                  <UnlockCountdown freeAt={p.freeAt} now={p.now.toISOString()} />
                </>
              ) : null}
            </p>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2.5 md:justify-start">
              <Link
                href={p.subscribeHref}
                className="inline-flex h-11 items-center rounded-[12px] bg-brand px-5 text-[15px] font-bold text-brand-ink transition-colors hover:bg-brand-hover"
              >
                {messages.reader.goPremium}
              </Link>
              {!p.signedIn ? (
                <Link
                  href={p.signInHref}
                  className="inline-flex h-11 items-center rounded-[12px] border border-line px-4 text-sm font-semibold text-fg transition-colors hover:bg-surface-2"
                >
                  {messages.readerUi.signInToUnlock}
                </Link>
              ) : null}
            </div>
            <p className="text-xs text-fg-subtle">{messages.premium.pitch}</p>
          </div>
        </section>
      </main>

      <nav
        aria-label={messages.reader.nextChapter}
        className="flex h-[60px] shrink-0 items-center justify-center gap-2.5 border-t border-line bg-bg/95 px-3 pb-[env(safe-area-inset-bottom)]"
      >
        {p.prev ? (
          <Link href={p.prev.href} className={nav}>
            <ChevronLeft size={20} aria-hidden="true" className="text-fg-muted" />
            {messages.reader.prev}
          </Link>
        ) : (
          <span aria-disabled="true" className={nav}>
            <ChevronLeft size={20} aria-hidden="true" className="text-fg-muted" />
            {messages.reader.prev}
          </span>
        )}
        <Link href={p.seriesHref} className={`${nav} min-w-0 md:w-[220px]`}>
          <span className="truncate">{p.chapterLabel}</span>
        </Link>
        {p.next ? (
          <Link href={p.next.href} className={nav}>
            {messages.reader.next}
            <ChevronRight size={20} aria-hidden="true" className="text-fg-muted" />
          </Link>
        ) : (
          <span aria-disabled="true" className={nav}>
            {messages.reader.next}
            <ChevronRight size={20} aria-hidden="true" className="text-fg-muted" />
          </span>
        )}
      </nav>
    </div>
  )
}
