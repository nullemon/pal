'use client'

import { fmt, messages } from '@palscans/core/messages'
import { ChevronLeft, ChevronRight, Menu } from 'lucide-react'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AdBand } from './ads'
import { PageImage } from './PageImage'
import { type ReaderItem, spreadAt } from './sequence'
import type { ReaderAds, ReaderDirection, ReaderFit, ReaderMode, ReaderPage } from './types'
import {
  isZoomed,
  type Point,
  pinchTransform,
  pinchZoom,
  touchDistance,
  touchMidpoint,
} from './zoom'

export interface PagedViewProps {
  items: ReaderItem[]
  pages: ReaderPage[]
  itemIndex: number
  mode: ReaderMode
  fit: ReaderFit
  direction: ReaderDirection
  preload: number
  /** Magnification of the fitted page, 1–4 (`zoom.ts`). */
  zoom: number
  /** Commit a new zoom (pinch release, double-tap). */
  onZoom: (zoom: number) => void
  srcFor: (page: ReaderPage, renderedWidth: number) => string
  altTemplate: string
  lightInk: boolean
  ads: ReaderAds
  top: number
  bottom: number
  showTapHint: boolean
  onDismissTapHint: () => void
  onPrev: () => void
  onNext: () => void
  onToggleChrome: () => void
  end: ReactNode
}

interface Size {
  w: number
  h: number
}

/**
 * The page at the chosen fit, then multiplied by the zoom.
 *
 * The zoom is applied last, on top of the fit, so it means the same thing in every fit mode
 * and on every screen: twice as big as what you were just looking at. It is a real width
 * rather than a transform, so `srcFor` below asks for a wider encode and the page sharpens
 * as it grows — see `zoom.ts`.
 */
const fitSize = (
  page: ReaderPage,
  stage: Size,
  fit: ReaderFit,
  columns: number,
  zoom = 1,
): Size => {
  const ratio = page.width / page.height
  const maxW = stage.w / columns
  const scale = (s: Size): Size => ({ w: s.w * zoom, h: s.h * zoom })
  if (fit === 'original') return scale({ w: page.width, h: page.height })
  if (fit === 'width') return scale({ w: maxW, h: maxW / ratio })
  let h = stage.h
  let w = h * ratio
  if (w > maxW) {
    w = maxW
    h = w / ratio
  }
  return scale({ w, h })
}

/**
 * docs/06 "Paged": one page (or a spread) fit to the stage, click zones on the left and
 * right 30%, the centre toggling the chrome, swipe on touch, and pages around the current
 * one preloaded. Ads are their own pages; the end panel scrolls.
 */
export function PagedView(p: PagedViewProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<Size>({ w: 0, h: 0 })
  const touch = useRef<{ x: number; y: number } | null>(null)
  const preloaded = useRef<Set<string>>(new Set())
  /** A pinch in progress: a transform while the fingers are down, a width when they lift. */
  const pinch = useRef<{ zoom: number; distance: number; origin: Point } | null>(null)
  const gestureRaf = useRef<number | null>(null)
  const [live, setLive] = useState<{ zoom: number; origin: Point } | null>(null)

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const shown = spreadAt(p.items, p.itemIndex, p.mode)
  const current = p.items[p.itemIndex]
  const columns = shown.length
  const isPage = current?.kind === 'page'

  // Preload ahead (and one behind) so turning is instant.
  useEffect(() => {
    if (stage.w === 0) return
    const targets: number[] = []
    for (let i = p.itemIndex - 1; i <= p.itemIndex + p.preload; i++) {
      const it = p.items[i]
      if (it?.kind === 'page') targets.push(it.idx)
    }
    for (const idx of targets) {
      const page = p.pages[idx]
      if (!page) continue
      const src = p.srcFor(page, fitSize(page, stage, p.fit, columns, p.zoom).w)
      if (preloaded.current.has(src)) continue
      preloaded.current.add(src)
      const img = new Image()
      img.decoding = 'async'
      img.src = src
    }
  }, [p.itemIndex, p.preload, p.items, p.pages, p.srcFor, p.fit, p.zoom, stage, columns])

  const rtl = p.direction === 'rtl'
  const left = rtl ? p.onNext : p.onPrev
  const right = rtl ? p.onPrev : p.onNext
  const zoomed = isZoomed(p.zoom)
  /**
   * A zoomed page is bigger than the stage in both directions, so the stage has to pan —
   * and the page-turn affordances have to get out of the way while it does. Left as they
   * were, the click zones and the swipe turn the page on the first attempt to move around a
   * page the reader has just zoomed in to look at, which reads as the zoom losing their
   * place rather than as the zoom working.
   */
  const scrolls = p.fit !== 'height' || zoomed || current?.kind === 'end'

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the stage carries the pinch and double-click-to-zoom; both have keyboard equivalents on the reader root (+ − 0), and every page-turn and chrome affordance inside it is a real button
    <div
      ref={stageRef}
      className={`absolute inset-x-0 flex transition-[top,bottom] duration-200 motion-reduce:transition-none ${
        scrolls ? 'overflow-auto overscroll-contain' : 'overflow-hidden'
      } ${current?.kind === 'end' ? 'items-start' : ''}`}
      style={{
        top: p.top,
        bottom: p.bottom,
        /*
         * `safe` centring, which is the difference between panning a zoomed page and only
         * being able to pan half of it.
         *
         * A flex container that centres its content puts the overflow on *both* sides, and
         * the overflow on the start side is unreachable by scrolling — so at 250% the
         * left-hand third and the top of the page simply could not be reached, which on a
         * right-to-left manga is the side the panel starts on. `safe` falls back to
         * start-alignment the moment the content is bigger than the box, and behaves
         * exactly like plain centring when it is not.
         */
        justifyContent: 'safe center',
        ...(current?.kind === 'end' ? {} : { alignItems: 'safe center' }),
        // Ours, not the browser's: the pinch below replaces a native one that cannot work
        // inside the reader's fixed overlay (`zoom.ts`). Scrolling and the zoomed-in pan
        // stay native, and so stay on the compositor thread.
        touchAction: 'pan-x pan-y',
      }}
      onTouchStart={(e) => {
        if (e.touches.length === 2) {
          const [a, b] = [e.touches[0], e.touches[1]]
          if (!a || !b) return
          // Two fingers down is never a swipe, so drop the one-finger candidate or lifting
          // out of a pinch turns the page.
          touch.current = null
          const mid = touchMidpoint({ x: a.clientX, y: a.clientY }, { x: b.clientX, y: b.clientY })
          const rect = stageRef.current?.getBoundingClientRect()
          pinch.current = {
            zoom: p.zoom,
            distance: touchDistance({ x: a.clientX, y: a.clientY }, { x: b.clientX, y: b.clientY }),
            origin: rect ? { x: mid.x - rect.left, y: mid.y - rect.top } : mid,
          }
          setLive({ zoom: p.zoom, origin: pinch.current.origin })
          return
        }
        const t = e.touches[0]
        touch.current = t ? { x: t.clientX, y: t.clientY } : null
      }}
      onTouchMove={(e) => {
        const start = pinch.current
        if (!start || e.touches.length !== 2) return
        const [a, b] = [e.touches[0], e.touches[1]]
        if (!a || !b) return
        const d = touchDistance({ x: a.clientX, y: a.clientY }, { x: b.clientX, y: b.clientY })
        if (gestureRaf.current !== null) return
        gestureRaf.current = window.requestAnimationFrame(() => {
          gestureRaf.current = null
          setLive({ zoom: pinchZoom(start.zoom, start.distance, d), origin: start.origin })
        })
      }}
      onTouchEnd={(e) => {
        if (pinch.current) {
          const settled = live?.zoom ?? pinch.current.zoom
          pinch.current = null
          if (gestureRaf.current !== null) {
            window.cancelAnimationFrame(gestureRaf.current)
            gestureRaf.current = null
          }
          setLive(null)
          if (settled !== p.zoom) p.onZoom(settled)
          return
        }
        const start = touch.current
        const t = e.changedTouches[0]
        touch.current = null
        // A swipe across a zoomed page is a pan, not a page turn.
        if (!start || !t || zoomed) return
        const dx = t.clientX - start.x
        const dy = t.clientY - start.y
        if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return
        if (dx < 0) right()
        else left()
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('a,button,select,label,input,textarea')) return
        p.onZoom(zoomed ? 1 : 2)
      }}
    >
      {current?.kind === 'end' ? (
        <div className="w-full">{p.end}</div>
      ) : current?.kind === 'ad' ? (
        <AdBand ads={p.ads} n={current.n} className="max-w-[820px]" />
      ) : stage.w > 0 ? (
        <div
          className={`flex shrink-0 items-center justify-center ${rtl ? 'flex-row-reverse' : ''}`}
          style={live ? pinchTransform(p.zoom, live.zoom, live.origin) : undefined}
        >
          {shown.map((i) => {
            const it = p.items[i]
            if (it?.kind !== 'page') return null
            const page = p.pages[it.idx]
            if (!page) return null
            const size = fitSize(page, stage, p.fit, columns, p.zoom)
            return (
              <PageImage
                key={page.idx}
                page={page}
                src={p.srcFor(page, size.w)}
                alt={fmt(p.altTemplate, { n: page.idx + 1 })}
                priority
                load
                counter={`${page.idx + 1} / ${p.pages.length}`}
                lightInk={p.lightInk}
                className="shrink-0 shadow-page"
                style={{ width: size.w, height: size.h, aspectRatio: 'auto' }}
              />
            )
          })}
        </div>
      ) : null}

      {(isPage || current?.kind === 'ad') && !zoomed ? (
        <div className="pointer-events-none absolute inset-0 flex">
          <button
            type="button"
            aria-label={rtl ? messages.readerUi.nextPage : messages.readerUi.prevPage}
            onClick={left}
            className="group pointer-events-auto flex w-[30%] cursor-w-resize items-center justify-start pl-5 outline-none transition-colors hover:bg-[linear-gradient(90deg,var(--color-brand-wash),transparent)]"
          >
            <ChevronLeft
              size={48}
              aria-hidden="true"
              className="text-white opacity-[.08] transition-opacity group-hover:opacity-35"
            />
          </button>
          <button
            type="button"
            aria-label={messages.readerUi.tapMenu}
            onClick={p.onToggleChrome}
            className="pointer-events-auto w-[40%] cursor-default outline-none"
          />
          <button
            type="button"
            aria-label={rtl ? messages.readerUi.prevPage : messages.readerUi.nextPage}
            onClick={right}
            className="group pointer-events-auto flex w-[30%] cursor-e-resize items-center justify-end pr-5 outline-none transition-colors hover:bg-[linear-gradient(270deg,var(--color-brand-wash),transparent)]"
          >
            <ChevronRight
              size={48}
              aria-hidden="true"
              className="text-white opacity-[.08] transition-opacity group-hover:opacity-35"
            />
          </button>
        </div>
      ) : null}

      {p.showTapHint && isPage ? (
        <button
          type="button"
          aria-label={messages.reader.tapZones}
          onClick={p.onDismissTapHint}
          className="absolute inset-0 z-10 flex opacity-40 outline-none"
        >
          <span className="flex w-[30%] flex-col items-center justify-center gap-2 border-r border-white/45 bg-brand-hover/45 text-[15px] font-semibold tracking-[0.01em] text-white">
            <ChevronLeft size={28} aria-hidden="true" />
            {messages.readerUi.tapPrev}
          </span>
          <span className="flex w-[40%] flex-col items-center justify-center gap-2 bg-white/[.14] text-[15px] font-semibold tracking-[0.01em] text-white">
            <Menu size={28} aria-hidden="true" />
            {messages.readerUi.tapMenu}
          </span>
          <span className="flex w-[30%] flex-col items-center justify-center gap-2 border-l border-white/45 bg-brand-hover/45 text-[15px] font-semibold tracking-[0.01em] text-white">
            <ChevronRight size={28} aria-hidden="true" />
            {messages.readerUi.tapNext}
          </span>
        </button>
      ) : null}
    </div>
  )
}
