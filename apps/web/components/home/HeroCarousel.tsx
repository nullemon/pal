'use client'

import { fmt, messages } from '@palscans/core/messages'
import { cn, RelativeTime } from '@palscans/ui'
import { Play } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

/** Plain data for one slide — resolved on the server, safe to cross into this island. */
export interface HeroSlideData {
  id: number
  title: string
  href: string
  coverSrc: string
  coverWidth: number
  coverHeight: number
  typeLabel: string
  typeClass: string
  rating: number | null
  latest: { label: string; publishedAt: string | null; href: string } | null
}

export interface HeroCarouselProps {
  slides: HeroSlideData[]
  /** Autoplay interval on desktop; 0 disables. */
  autoplayMs?: number
}

const AUTOPLAY_MS = 6000
const SIDE = 160
const SIDE_H = 229

/**
 * Layout A hero (design/mockups/A/Main.dc.html): the active cover centred and enlarged with
 * its blurred cover as backdrop, three neighbours a side, dots, 6s autoplay that pauses on
 * hover and under `prefers-reduced-motion`. Below `md` it is a CSS scroll-snap rail with
 * no autoplay (docs/06 "Hero"). The markup is server-rendered; only the interaction is
 * client-side.
 */
export function HeroCarousel({ slides, autoplayMs = AUTOPLAY_MS }: HeroCarouselProps) {
  const n = slides.length
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const railRef = useRef<HTMLUListElement>(null)
  const scrollingTo = useRef<number | null>(null)

  // Desktop autoplay only: no timer below md, none under reduced motion, none while hovered.
  useEffect(() => {
    if (n < 2 || paused || autoplayMs <= 0) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const desktop = window.matchMedia('(min-width: 768px)')
    if (reduced.matches || !desktop.matches) return
    const id = window.setInterval(() => setActive((a) => (a + 1) % n), autoplayMs)
    return () => window.clearInterval(id)
  }, [n, paused, autoplayMs])

  // Mobile: the dots follow whichever slide is snapped into view.
  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    const items = Array.from(rail.querySelectorAll<HTMLElement>('[data-slide]'))
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const idx = Number(e.target.getAttribute('data-slide'))
          if (scrollingTo.current === idx) scrollingTo.current = null
          if (scrollingTo.current === null) setActive(idx)
        }
      },
      { root: rail, threshold: 0.6 },
    )
    for (const el of items) io.observe(el)
    return () => io.disconnect()
  }, [])

  const goTo = useCallback((idx: number) => {
    setActive(idx)
    const rail = railRef.current
    const el = rail?.querySelector<HTMLElement>(`[data-slide="${idx}"]`)
    if (rail && el && rail.clientWidth > 0 && getComputedStyle(rail).display !== 'none') {
      scrollingTo.current = idx
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }
  }, [])

  if (n === 0) return null
  const current = slides[active] ?? slides[0]
  if (!current) return null

  // Desktop ordering: the active slide in the middle, up to three neighbours a side.
  const sides = Math.min(3, Math.floor((n - 1) / 2))
  const offsets: number[] = []
  for (let o = -sides; o <= sides; o++) offsets.push(o)
  if (n - 1 > sides * 2) offsets.push(sides + 1)
  const opacityFor = (d: number) => (d >= 3 ? 'opacity-50' : d === 2 ? 'opacity-60' : 'opacity-70')

  return (
    <section
      aria-roledescription="carousel"
      aria-label={messages.discovery.featuredSeries}
      className="relative overflow-hidden bg-surface-1"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <img
        key={current.id}
        src={current.coverSrc}
        alt=""
        aria-hidden="true"
        width={current.coverWidth}
        height={current.coverHeight}
        className="pointer-events-none absolute -left-[5%] -top-[5%] h-[110%] w-[110%] object-cover blur-[28px] brightness-[.42] saturate-[1.3]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-linear-to-b from-bg/30 via-bg/10 via-45% to-bg"
      />

      {/* md+: centred stage */}
      <div className="relative hidden h-[360px] flex-col items-center pt-3.5 md:flex">
        <div className="flex items-center gap-4">
          {offsets.map((offset) => {
            const idx = (active + offset + n * 4) % n
            const s = slides[idx]
            if (!s) return null
            if (offset === 0) return <ActiveSlide key={`a-${s.id}`} slide={s} />
            return (
              <button
                key={`n-${s.id}`}
                type="button"
                onClick={() => goTo(idx)}
                aria-label={fmt(messages.discovery.showSlide, { title: s.title })}
                className={cn(
                  'group block shrink-0 overflow-hidden rounded-md shadow-2 transition-opacity duration-200 hover:opacity-100',
                  opacityFor(Math.abs(offset)),
                )}
                style={{ width: SIDE, height: SIDE_H }}
              >
                <img
                  src={s.coverSrc}
                  alt=""
                  width={s.coverWidth}
                  height={s.coverHeight}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-200 motion-safe:group-hover:scale-[1.04]"
                />
              </button>
            )
          })}
        </div>
        <Dots slides={slides} active={active} onSelect={goTo} className="mt-3" />
      </div>

      {/* below md: scroll-snap rail, no autoplay */}
      <div className="relative flex flex-col items-center pb-3 pt-4 md:hidden">
        <ul
          ref={railRef}
          className="flex w-full snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain px-[calc(50%-110px)] pb-1 [scrollbar-width:none]"
        >
          {slides.map((s, i) => (
            <li key={s.id} data-slide={i} className="shrink-0 snap-center">
              <ActiveSlide slide={s} priority={i === 0} />
            </li>
          ))}
        </ul>
        <Dots slides={slides} active={active} onSelect={goTo} className="mt-2" />
      </div>
    </section>
  )
}

function ActiveSlide({ slide, priority = true }: { slide: HeroSlideData; priority?: boolean }) {
  return (
    <article
      className="relative h-[315px] w-[220px] shrink-0 overflow-hidden rounded-[10px] shadow-2 ring-2 ring-brand/75"
      aria-label={slide.title}
    >
      <img
        src={slide.coverSrc}
        alt={fmt(messages.discovery.coverAlt, { title: slide.title })}
        width={slide.coverWidth}
        height={slide.coverHeight}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding={priority ? 'sync' : 'async'}
        className="h-full w-full object-cover"
      />
      {slide.rating !== null ? (
        <span className="absolute left-2.5 top-2.5 inline-flex h-6 items-center gap-1 rounded-md bg-gold px-2 text-[12px] font-extrabold tabular-nums text-bg">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" />
          </svg>
          {slide.rating.toFixed(1)}
        </span>
      ) : null}
      <span
        className={cn(
          'absolute right-2.5 top-2.5 inline-flex h-[22px] items-center rounded-[5px] px-[7px] text-[10px] font-extrabold uppercase tracking-[0.08em]',
          slide.typeClass,
        )}
      >
        {slide.typeLabel}
      </span>
      <div className="absolute inset-x-0 bottom-0 bg-linear-to-b from-bg/0 via-bg/90 via-45% to-bg/95 px-3 pb-3 pt-10">
        <Link
          href={slide.href}
          className="block font-display text-[15px] font-extrabold uppercase leading-[17px] tracking-[-0.01em] text-fg hover:text-brand-hover"
        >
          {slide.title}
        </Link>
        {slide.latest ? (
          <p className="mt-1 text-[11px] font-medium text-fg-muted">
            {slide.latest.label}
            {slide.latest.publishedAt ? (
              <>
                {' · '}
                <RelativeTime iso={slide.latest.publishedAt} />
              </>
            ) : null}
          </p>
        ) : null}
        <Link
          href={slide.latest?.href ?? slide.href}
          className="mt-2 flex h-8 items-center justify-center gap-1.5 rounded-md bg-brand text-[13px] font-bold text-brand-ink transition-colors hover:bg-brand-hover"
        >
          <Play size={14} aria-hidden="true" />
          {messages.discovery.readNow}
        </Link>
      </div>
    </article>
  )
}

function Dots({
  slides,
  active,
  onSelect,
  className,
}: {
  slides: HeroSlideData[]
  active: number
  onSelect: (idx: number) => void
  className?: string
}) {
  if (slides.length < 2) return null
  return (
    <div
      role="tablist"
      aria-label={messages.discovery.featuredSeries}
      className={cn('flex items-center gap-1.5', className)}
    >
      {slides.map((s, i) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={i === active}
          aria-label={fmt(messages.discovery.slideOf, { n: i + 1, total: slides.length })}
          onClick={() => onSelect(i)}
          className={cn(
            'h-1.5 rounded-full transition-all duration-200',
            i === active ? 'w-5 bg-brand-hover' : 'w-1.5 bg-fg/35 hover:bg-fg/60',
          )}
        />
      ))}
    </div>
  )
}
