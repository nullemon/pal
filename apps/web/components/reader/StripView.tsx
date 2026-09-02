'use client'

import { fmt } from '@palscans/core/messages'
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { AdBand } from './ads'
import { PageImage } from './PageImage'
import type { ReaderItem } from './sequence'
import type { ReaderAds, ReaderPage } from './types'

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
  onCurrentPage: (idx: number) => void
  onScroll: (state: { pct: number; delta: number; top: number }) => void
  onToggleChrome: () => void
  end: ReactNode
}

const EAGER = 3

/**
 * docs/06 "Long strip": every page in one 820px column, zero gap by default, first three
 * eager, the rest loaded by an IntersectionObserver at 150% of the viewport with a
 * BlurHash underneath. A second observer tracks the page with the most visible pixels.
 */
export function StripView(p: StripViewProps) {
  const colRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState<Set<number>>(() => new Set())
  const [colWidth, setColWidth] = useState(820)
  const lastTop = useRef(0)
  const raf = useRef<number | null>(null)
  const landed = useRef(false)
  const { onCurrentPage, onScroll, scrollRef, initialPage, topPad } = p

  // Rendered column width → which encode to serve.
  useEffect(() => {
    const el = colRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setColWidth(Math.round(el.clientWidth) || 820))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: tapping the artwork toggles the chrome (docs/06); the keyboard has H
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above
    <div
      ref={colRef}
      className="mx-auto flex w-full max-w-[820px] flex-col"
      style={{ paddingTop: topPad, paddingBottom: p.bottomPad, gap: p.gap }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a,button,select,label,input,textarea')) return
        p.onToggleChrome()
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
