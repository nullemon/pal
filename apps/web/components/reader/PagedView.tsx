'use client'

import { fmt, messages } from '@palscans/core/messages'
import { ChevronLeft, ChevronRight, Menu } from 'lucide-react'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AdBand } from './ads'
import { PageImage } from './PageImage'
import { type ReaderItem, spreadAt } from './sequence'
import type { ReaderAds, ReaderDirection, ReaderFit, ReaderMode, ReaderPage } from './types'

export interface PagedViewProps {
  items: ReaderItem[]
  pages: ReaderPage[]
  itemIndex: number
  mode: ReaderMode
  fit: ReaderFit
  direction: ReaderDirection
  preload: number
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

const fitSize = (page: ReaderPage, stage: Size, fit: ReaderFit, columns: number): Size => {
  const ratio = page.width / page.height
  const maxW = stage.w / columns
  if (fit === 'original') return { w: page.width, h: page.height }
  if (fit === 'width') return { w: maxW, h: maxW / ratio }
  let h = stage.h
  let w = h * ratio
  if (w > maxW) {
    w = maxW
    h = w / ratio
  }
  return { w, h }
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
      const src = p.srcFor(page, fitSize(page, stage, p.fit, columns).w)
      if (preloaded.current.has(src)) continue
      preloaded.current.add(src)
      const img = new Image()
      img.decoding = 'async'
      img.src = src
    }
  }, [p.itemIndex, p.preload, p.items, p.pages, p.srcFor, p.fit, stage, columns])

  const rtl = p.direction === 'rtl'
  const left = rtl ? p.onNext : p.onPrev
  const right = rtl ? p.onPrev : p.onNext
  const scrolls = p.fit !== 'height' || current?.kind === 'end'

  return (
    <div
      ref={stageRef}
      className={`absolute inset-x-0 flex transition-[top,bottom] duration-200 motion-reduce:transition-none ${
        scrolls ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden'
      } ${current?.kind === 'end' ? 'items-start' : 'items-center'} justify-center`}
      style={{ top: p.top, bottom: p.bottom }}
      onTouchStart={(e) => {
        const t = e.touches[0]
        touch.current = t ? { x: t.clientX, y: t.clientY } : null
      }}
      onTouchEnd={(e) => {
        const start = touch.current
        const t = e.changedTouches[0]
        touch.current = null
        if (!start || !t) return
        const dx = t.clientX - start.x
        const dy = t.clientY - start.y
        if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return
        if (dx < 0) right()
        else left()
      }}
    >
      {current?.kind === 'end' ? (
        <div className="w-full">{p.end}</div>
      ) : current?.kind === 'ad' ? (
        <AdBand ads={p.ads} n={current.n} className="max-w-[820px]" />
      ) : stage.w > 0 ? (
        <div className={`flex items-center justify-center ${rtl ? 'flex-row-reverse' : ''}`}>
          {shown.map((i) => {
            const it = p.items[i]
            if (it?.kind !== 'page') return null
            const page = p.pages[it.idx]
            if (!page) return null
            const size = fitSize(page, stage, p.fit, columns)
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

      {isPage || current?.kind === 'ad' ? (
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
