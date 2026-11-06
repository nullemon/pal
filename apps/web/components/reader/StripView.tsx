'use client'

import { fmt } from '@palscans/core/messages'
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { AdBand } from './ads'
import { PageImage } from './PageImage'
import type { ReaderItem } from './sequence'
import type { ReaderAds, ReaderPage } from './types'
import {
  anchorScroll,
  isZoomed,
  type Point,
  pinchTransform,
  pinchZoom,
  touchDistance,
  touchMidpoint,
  zoomedWidth,
} from './zoom'

export interface StripViewProps {
  scrollRef: RefObject<HTMLDivElement | null>
  items: ReaderItem[]
  pages: ReaderPage[]
  srcFor: (page: ReaderPage, renderedWidth: number) => string
  altTemplate: string
  gap: number
  lightInk: boolean
  ads: ReaderAds
  topPad: number
  bottomPad: number
  /** Page to scroll to on mount (resume, or the page the paged view was on). */
  initialPage: number
  /** Magnification of the column, 1–4 (`zoom.ts`). */
  zoom: number
  /** Commit a new zoom (pinch release, double-tap). */
  onZoom: (zoom: number) => void
  onCurrentPage: (idx: number) => void
  onScroll: (state: { pct: number; delta: number; top: number }) => void
  onToggleChrome: () => void
  end: ReactNode
}

const EAGER = 3

/** The reading column at 100%: docs/06's 820px, now the base the zoom multiplies. */
export const MAX_COLUMN = 820

/**
 * docs/06 "Long strip": every page in one 820px column, zero gap by default, first three
 * eager, the rest loaded by an IntersectionObserver at 150% of the viewport with a
 * BlurHash underneath. A second observer tracks the page with the most visible pixels.
 *
 * Zoom widens the column rather than scaling it, so the variant picker asks for a wider
 * encode and the artwork gets sharper instead of softer — see the note in `zoom.ts` for why
 * the browser's own zoom cannot do this. A pinch in progress is the exception: it rides on a
 * CSS transform, because reflowing forty pages on every frame of a gesture is not smooth on
 * the phones most of these chapters are read on. The transform is swapped for the real width
 * when the fingers lift.
 */
export function StripView(p: StripViewProps) {
  const colRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState<Set<number>>(() => new Set())
  const [available, setAvailable] = useState(MAX_COLUMN)
  const [live, setLive] = useState<{ zoom: number; origin: Point } | null>(null)
  const lastTop = useRef(0)
  const raf = useRef<number | null>(null)
  const landed = useRef(false)
  const { onCurrentPage, onScroll, scrollRef, initialPage, topPad, zoom, onZoom } = p

  const colWidth = zoomedWidth(available, MAX_COLUMN, zoom)
  /**
   * At 100% the width stays pure CSS, and only a zoom uses the measured number.
   *
   * `available` cannot be known until the container has been observed, so a measured width
   * would render 820px on the server and for the first frame on a phone — a horizontal
   * overflow on every cold load, on the screens most of these chapters are read on.
   * `min(100%, 820px)` is the same rule the old `w-full max-w-[820px]` expressed and it is
   * correct before anything has been measured. By the time a zoom is in play the observer
   * has long since run.
   */
  const widthCss = isZoomed(zoom) ? `${colWidth}px` : `min(100%, ${MAX_COLUMN}px)`

  /**
   * How wide the column is allowed to be at 100% — the scroll container, not the column.
   *
   * Measuring the column itself (which it used to) cannot work once the width is set from
   * the zoom: the observer would report the width we just assigned and the zoom would
   * compound on itself every frame.
   */
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const measure = () => setAvailable(Math.round(root.clientWidth) || MAX_COLUMN)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    return () => ro.disconnect()
  }, [scrollRef])

  // Resume / mode switch: land on the page once, under the top bar; later scrolls are the reader's own.
  useEffect(() => {
    const root = scrollRef.current
    const col = colRef.current
    if (landed.current || !root || !col) return
    landed.current = true
    if (initialPage <= 0) return
    const el = col.querySelector<HTMLElement>(`[data-page="${initialPage}"]`)
    if (el) root.scrollTo({ top: Math.max(0, el.offsetTop - topPad) })
  }, [scrollRef, initialPage, topPad])

  /**
   * Keep what the reader was looking at where it was when the zoom changes.
   *
   * This is the whole difference between a zoom that helps and one nobody uses twice. A long
   * strip grows downward from the top of the chapter, so without an anchor the bubble you
   * zoomed in to read is suddenly several screens away and you have to go and find it again
   * — you lose your place as well as gaining magnification.
   *
   * The focal point is wherever the input was (pinch midpoint, cursor) or the middle of the
   * screen for a keypress. Done in a layout effect so the scroll is corrected in the same
   * frame as the new width, before anything is painted at the wrong offset.
   */
  const focal = useRef<Point | null>(null)
  const prevZoom = useRef(zoom)
  useLayoutEffect(() => {
    const root = scrollRef.current
    const from = prevZoom.current
    prevZoom.current = zoom
    if (!root || from === zoom) return
    const at = focal.current ?? { x: root.clientWidth / 2, y: root.clientHeight / 2 }
    focal.current = null
    const next = anchorScroll({ left: root.scrollLeft, top: root.scrollTop }, at, from, zoom)
    root.scrollLeft = next.left
    root.scrollTop = next.top
    /*
     * Our jump, not the reader's.
     *
     * The scroll handler below turns a downward delta into "hide the chrome", and anchoring
     * a zoom moves the scroll position by hundreds of pixels — so zooming in made the bars
     * vanish, which reads as the zoom button also doing something else. Moving the baseline
     * with the scroll leaves the next real scroll event a delta of about zero.
     */
    lastTop.current = next.top
  }, [zoom, scrollRef])

  // Lazy loading at 150% and current-page tracking.
  useEffect(() => {
    const root = scrollRef.current
    const col = colRef.current
    if (!root || !col) return
    const figures = Array.from(col.querySelectorAll<HTMLElement>('[data-page]'))
    const lazy = new IntersectionObserver(
      (entries) => {
        const hit: number[] = []
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const idx = Number((e.target as HTMLElement).dataset.page)
          hit.push(idx)
          lazy.unobserve(e.target)
        }
        if (hit.length)
          setLoaded((prev) => {
            const next = new Set(prev)
            for (const i of hit) next.add(i)
            return next
          })
      },
      { root, rootMargin: '150% 0px' },
    )
    const visible = new Map<number, number>()
    const track = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const idx = Number((e.target as HTMLElement).dataset.page)
          visible.set(idx, e.isIntersecting ? e.intersectionRect.height : 0)
        }
        let best = -1
        let bestH = 0
        for (const [idx, h] of visible) {
          if (h > bestH || (h === bestH && h > 0 && idx < best)) {
            best = idx
            bestH = h
          }
        }
        if (best >= 0) onCurrentPage(best)
      },
      { root, threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] },
    )
    for (const f of figures) {
      lazy.observe(f)
      track.observe(f)
    }
    return () => {
      lazy.disconnect()
      track.disconnect()
    }
  }, [scrollRef, onCurrentPage])

  // Scroll: progress percentage and direction for the chrome auto-hide.
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const handler = () => {
      if (raf.current !== null) return
      raf.current = window.requestAnimationFrame(() => {
        raf.current = null
        const max = root.scrollHeight - root.clientHeight
        const top = root.scrollTop
        onScroll({ pct: max > 0 ? top / max : 1, delta: top - lastTop.current, top })
        lastTop.current = top
      })
    }
    root.addEventListener('scroll', handler, { passive: true })
    handler()
    return () => {
      root.removeEventListener('scroll', handler)
      if (raf.current !== null) window.cancelAnimationFrame(raf.current)
    }
  }, [scrollRef, onScroll])

  /** The pinch, in the column's own coordinates so the transform origin lands between the fingers. */
  const pinch = useRef<{ zoom: number; distance: number; origin: Point } | null>(null)
  const gestureRaf = useRef<number | null>(null)

  const pointIn = useCallback((x: number, y: number): Point => {
    const rect = colRef.current?.getBoundingClientRect()
    return rect ? { x: x - rect.left, y: y - rect.top } : { x, y }
  }, [])

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length !== 2) return
      const [a, b] = [e.touches[0], e.touches[1]]
      if (!a || !b) return
      const mid = touchMidpoint({ x: a.clientX, y: a.clientY }, { x: b.clientX, y: b.clientY })
      pinch.current = {
        zoom,
        distance: touchDistance({ x: a.clientX, y: a.clientY }, { x: b.clientX, y: b.clientY }),
        origin: pointIn(mid.x, mid.y),
      }
      setLive({ zoom, origin: pinch.current.origin })
    },
    [zoom, pointIn],
  )

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const start = pinch.current
    if (!start || e.touches.length !== 2) return
    const [a, b] = [e.touches[0], e.touches[1]]
    if (!a || !b) return
    /*
     * No `preventDefault()` here, deliberately. React registers `touchmove` passively, so
     * the call would warn and do nothing; the browser's own pinch and double-tap zoom are
     * turned off by `touch-action: pan-x pan-y` on the scroll container instead, which also
     * leaves the one-finger scroll and the zoomed-in horizontal pan on the compositor
     * thread where they belong.
     */
    const d = touchDistance({ x: a.clientX, y: a.clientY }, { x: b.clientX, y: b.clientY })
    if (gestureRaf.current !== null) return
    gestureRaf.current = window.requestAnimationFrame(() => {
      gestureRaf.current = null
      setLive({ zoom: pinchZoom(start.zoom, start.distance, d), origin: start.origin })
    })
  }, [])

  const endPinch = useCallback(() => {
    const start = pinch.current
    if (!start) return
    pinch.current = null
    if (gestureRaf.current !== null) {
      window.cancelAnimationFrame(gestureRaf.current)
      gestureRaf.current = null
    }
    const settled = live?.zoom ?? start.zoom
    setLive(null)
    if (settled === zoom) return
    // The anchor below works in container coordinates, and the origin was taken in the
    // column's; the column is centred, so the horizontal difference is the gutter.
    const root = scrollRef.current
    const rect = colRef.current?.getBoundingClientRect()
    if (root && rect)
      focal.current = {
        x: start.origin.x + rect.left - root.getBoundingClientRect().left,
        y: start.origin.y + rect.top - root.getBoundingClientRect().top,
      }
    onZoom(settled)
  }, [live, zoom, onZoom, scrollRef])

  const transform = live ? pinchTransform(zoom, live.zoom, live.origin) : null

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: tapping the artwork toggles the chrome (docs/06); the keyboard has H
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above
    <div
      ref={colRef}
      className="flex flex-col"
      style={{
        width: widthCss,
        // `auto` margins centre the column while it fits and collapse to the left edge once
        // it does not, which is what the horizontal scroll then pans across.
        marginInline: 'auto',
        paddingTop: topPad,
        paddingBottom: p.bottomPad,
        gap: p.gap,
        ...(transform ?? {}),
        // Only while the fingers are down: a transition here would fight the gesture, and a
        // promoted layer left behind on a forty-page strip costs memory for nothing.
        willChange: live ? 'transform' : undefined,
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={endPinch}
      onTouchCancel={endPinch}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a,button,select,label,input,textarea')) return
        // A pan of a zoomed page ends in a click on the artwork; toggling the chrome then
        // would make every attempt to move around flash the bars.
        if (pinch.current) return
        p.onToggleChrome()
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('a,button,select,label,input,textarea')) return
        const root = scrollRef.current
        if (root) {
          const rect = root.getBoundingClientRect()
          focal.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
        }
        onZoom(isZoomed(zoom) ? 1 : 2)
      }}
    >
      {p.items.map((it) => {
        if (it.kind === 'ad')
          return <AdBand key={`ad-${it.n}`} ads={p.ads} n={it.n} className="md:hidden" />
        if (it.kind === 'end') return <div key="end">{p.end}</div>
        const page = p.pages[it.idx]
        if (!page) return null
        return (
          <PageImage
            key={page.idx}
            page={page}
            src={p.srcFor(page, colWidth)}
            alt={fmt(p.altTemplate, { n: page.idx + 1 })}
            priority={page.idx < EAGER}
            load={loaded.has(page.idx)}
            counter={`${page.idx + 1} / ${p.pages.length}`}
            lightInk={p.lightInk}
          />
        )
      })}
    </div>
  )
}
