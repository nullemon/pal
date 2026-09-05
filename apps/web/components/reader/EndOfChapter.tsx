'use client'

import { fmt, messages } from '@palscans/core/messages'
import { ArrowRight, Lock, Shuffle } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { RecommendedRail } from '@/components/discovery/RecommendedRail'
import { EndSlot } from './ads'
import type { ChapterLink, ReaderAds } from './types'

export interface EndOfChapterProps {
  chapterNumber: string
  next: ChapterLink | null
  seriesHref: string
  seriesTitle: string
  subscribeHref: string
  ads: ReaderAds
  mobile: boolean
  /** The chapter comments (a server-rendered island) go under the card. */
  comments?: ReactNode
}

/** After the last page: the end slot, then the Next Chapter card, then comments (docs/06, docs/11). */
export function EndOfChapter(p: EndOfChapterProps) {
  return (
    <section
      aria-label={messages.reader.endOfChapter}
      className="mx-auto flex w-full max-w-[820px] flex-col items-center gap-6 px-4 py-10 text-fg"
    >
      <p className="font-display text-xs font-extrabold uppercase tracking-[0.18em] text-fg-subtle">
        {fmt(messages.readerUi.endTitle, { n: p.chapterNumber })}
      </p>
      <EndSlot ads={p.ads} mobile={p.mobile} />
      {p.next ? (
        <Link
          href={p.next.href}
          className="group flex w-full max-w-[520px] items-center gap-4 rounded-lg border border-line bg-surface-1 p-4 transition-colors hover:border-brand-hover hover:bg-surface-2"
        >
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-fg-subtle">
              {messages.readerUi.upNext}
            </div>
            <div className="mt-1 truncate text-base font-bold">{p.next.label}</div>
            <div className="truncate text-sm text-fg-muted">{p.seriesTitle}</div>
          </div>
          {p.next.locked ? (
            <span className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-line px-4 text-sm font-semibold text-fg-muted">
              <Lock size={16} aria-hidden="true" />
              {messages.series.premiumOnly}
            </span>
          ) : (
            <span className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-brand px-4 text-sm font-bold text-brand-ink transition-colors group-hover:bg-brand-hover">
              {messages.readerUi.readNext}
              <ArrowRight size={16} aria-hidden="true" />
            </span>
          )}
        </Link>
      ) : (
        <div className="w-full max-w-[520px] rounded-lg border border-line bg-surface-1 p-5 text-center">
          <div className="text-base font-bold">{messages.reader.noNextChapter}</div>
          <p className="mt-1 text-sm text-fg-muted">{messages.readerUi.caughtUpBody}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3 text-sm font-semibold">
        <Link
          href={p.seriesHref}
          className="inline-flex h-11 items-center rounded-[10px] border border-line px-4 text-fg transition-colors hover:bg-surface-2"
        >
          {messages.seriesDetail.breadcrumbSeries}: {p.seriesTitle}
        </Link>
        {/* Nothing left in this series is the one moment a random title is a real answer. */}
        {p.next ? null : (
          <Link
            href="/random"
            prefetch={false}
            className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-line px-4 text-fg transition-colors hover:bg-surface-2"
          >
            <Shuffle size={15} aria-hidden="true" />
            {messages.discover.surpriseMe}
          </Link>
        )}
        {p.ads.enabled ? (
          <Link
            href={p.subscribeHref}
            className="inline-flex h-11 items-center rounded-[10px] px-3 text-brand-hover hover:underline"
          >
            {messages.premium.adBlockNote}
          </Link>
        ) : null}
      </div>
      {/* docs/12 §10 "recommended series … internal linking is structural" — below the Next
          Chapter button, which must stay the first thing a thumb reaches. */}
      <RecommendedRail seriesHref={p.seriesHref} className="pt-2" />
      {p.comments ? <div className="w-full pt-4">{p.comments}</div> : null}
    </section>
  )
}
