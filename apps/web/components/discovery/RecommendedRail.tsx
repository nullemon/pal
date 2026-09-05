'use client'

import { fmt, messages } from '@palscans/core/messages'
import { cn } from '@palscans/ui'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { COVER_HEIGHT, COVER_WIDTH } from './cover'
import { readerRecommendations } from './recommendations'
import type { SeriesSummary } from './types'

/**
 * "More like this" under the end-of-chapter card. Deliberately below the Next Chapter
 * button: finishing a chapter of something you are already reading has one obvious next
 * step, and nothing here may push it off a phone screen.
 *
 * The list is fetched only once the card comes near the viewport. It sits below every page
 * of the chapter, so most sessions never reach it — and a query per chapter load, for a rail
 * nobody scrolls to, is the kind of cost that only shows up in the database graphs.
 */

const SKELETON = [0, 1, 2, 3, 4, 5]

export interface RecommendedRailProps {
  /** `/series/<slug>` — the series just read. */
  seriesHref: string
  className?: string
}

/** `/series/frost-monarch` → `frost-monarch`. Empty for anything else. */
export const slugFromSeriesHref = (href: string): string => {
  const match = /^\/series\/([^/?#]+)/.exec(href)
  try {
    return match?.[1] ? decodeURIComponent(match[1]) : ''
  } catch {
    return ''
  }
}

const item = 'w-[96px] shrink-0 sm:w-auto sm:flex-1 sm:min-w-0'

export function RecommendedRail({ seriesHref, className }: RecommendedRailProps) {
  const slug = slugFromSeriesHref(seriesHref)
  const ref = useRef<HTMLElement>(null)
  const [items, setItems] = useState<SeriesSummary[] | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!slug || !node) return
    let cancelled = false

    const run = () => {
      setLoading(true)
      readerRecommendations(slug)
        .then((rows) => {
          if (!cancelled) setItems(rows)
        })
        .catch(() => {
          // A rail that cannot load is a rail that is not there; never break the reader.
          if (!cancelled) setItems([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }

    if (typeof IntersectionObserver !== 'function') {
      run()
      return () => {
        cancelled = true
      }
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect()
          run()
        }
      },
      { rootMargin: '600px' },
    )
    observer.observe(node)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [slug])

  // Nothing to show, and nothing on the way: take up no room at all.
  const empty = items !== null && items.length === 0
  return (
    <section
      ref={ref}
      aria-label={messages.seriesDetail.moreLikeThis}
      className={cn('w-full', empty && 'hidden', className)}
    >
      {loading || items ? (
        <h2 className="font-display text-xs font-extrabold uppercase tracking-[0.16em] text-fg-subtle">
          {messages.seriesDetail.moreLikeThis}
        </h2>
      ) : null}
      {items ? (
        <ul className="mt-3 flex gap-3 overflow-x-auto pb-1 sm:overflow-visible">
          {items.map((s) => (
            <li key={s.id} className={item}>
              <Link href={s.href} prefetch={false} className="group flex flex-col gap-1.5">
                <span className="relative block overflow-hidden rounded-md bg-surface-2">
                  {/* Covers are already sized by the worker; next/image adds nothing here. */}
                  <img
                    src={s.coverSrc}
                    alt={fmt(messages.discovery.coverAlt, { title: s.title })}
                    width={COVER_WIDTH}
                    height={COVER_HEIGHT}
                    loading="lazy"
                    decoding="async"
                    className={cn('aspect-[2/3] h-auto w-full object-cover', s.mature && 'blur-md')}
                  />
                  {s.ratingCount > 0 ? (
                    <span className="absolute right-1 top-1 rounded-sm bg-bg/85 px-1 py-0.5 text-[10px] font-bold tabular-nums text-gold">
                      {s.rating.toFixed(1)}
                    </span>
                  ) : null}
                </span>
                <span className="line-clamp-2 text-[12px] font-semibold leading-4 text-fg-muted group-hover:text-fg">
                  {s.title}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : loading ? (
        <ul aria-hidden="true" className="mt-3 flex gap-3 overflow-hidden pb-1">
          {SKELETON.map((i) => (
            <li key={i} className={item}>
              <span className="block aspect-[2/3] w-full animate-pulse rounded-md bg-surface-2" />
              <span className="mt-1.5 block h-4 w-4/5 animate-pulse rounded-sm bg-surface-2" />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
