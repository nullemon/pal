'use client'

import { fmt, messages } from '@palscans/core/messages'
import { useRouter } from 'next/navigation'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MergeDeviceProgress } from '@/lib/progress/DeviceProgress'
import { Skyscrapers } from './ads'
import { BottomBar, ChromeHint, FloatingPill, Kbd, ProgressBar, TopBar } from './chrome'
import { EndOfChapter } from './EndOfChapter'
import {
  useCoarsePointer,
  useIsMobile,
  useOnceFlag,
  useProgressWriter,
  useReaderSettings,
} from './hooks'
import { PagedView } from './PagedView'
import { pickVariant } from './quality'
import { ReportSheet } from './ReportSheet'
import { Scrubber } from './Scrubber'
import { StripView } from './StripView'
import {
  buildSequence,
  itemIndexOfPage,
  nextItemIndex,
  pageOfItem,
  prevItemIndex,
  progressOfPage,
} from './sequence'
import {
  backgroundStyle,
  isLightBackground,
  isPaged,
  loadLocalResume,
  TAP_HINT_KEY,
} from './settings'
import { MoreSheet, SettingsSheet, ShortcutsSheet } from './sheets'
import type { ReaderData, ReaderPage } from './types'

export interface ReaderProps {
  data: ReaderData
  /** Server-rendered chapter comments, shown after the end-of-chapter card. */
  comments?: ReactNode
}

/** Hides the site shell under the reader without touching the shared layout (docs/06: bottom nav hidden in the reader). */
const shellCss =
  'html:has(#reader-root){overflow:hidden;scrollbar-gutter:auto}body:has(#reader-root)>header,body:has(#reader-root)>footer,body:has(#reader-root)>nav{display:none}'

const PREFETCH_AT = 0.8

export function Reader({ data, comments }: ReaderProps) {
  const router = useRouter()
  const mobile = useIsMobile()
  const coarse = useCoarsePointer()
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { settings, update, hydrated } = useReaderSettings({
    mode: data.defaults.mode,
    direction: data.series.readingDirection === 'rtl' ? 'rtl' : 'ltr',
    background: data.defaults.background,
    narrow: mobile,
  })
  const paged = isPaged(settings.mode)
  const pageCount = data.pages.length

  const items = useMemo(
    () =>
      buildSequence({
        pageCount,
        interval: data.ads.mobileInterval,
        mobile: paged ? mobile : true,
        adsEnabled: data.ads.enabled,
      }),
    [pageCount, data.ads.mobileInterval, data.ads.enabled, paged, mobile],
  )

  // Position: the page the reader is on (both modes) and the paged item index.
  const [pageIdx, setPageIdx] = useState(data.viewer.resume?.pageIdx ?? 0)
  const [itemIndex, setItemIndexRaw] = useState(() =>
    itemIndexOfPage(items, data.viewer.resume?.pageIdx ?? 0),
  )
  const [scrollPct, setScrollPct] = useState(0)
  const [chrome, setChrome] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [tapHintSeen, markTapHint] = useOnceFlag(TAP_HINT_KEY)
  const [stripKey, setStripKey] = useState(0)
  const initialPage = useRef(data.viewer.resume?.pageIdx ?? 0)
  const prefetched = useRef(false)

  // The sequence changes with the mode and the viewport (ad pages come and go); this keeps
  // the reader on the same page through it. Declared here because the resume effect below
  // writes to it — see the note there.
  const pageRef = useRef(pageIdx)
  pageRef.current = pageIdx

  // Anonymous readers resume from the device (signed-in ones from the server row), once
  // the stored settings are known.
  const resumed = useRef(false)
  useEffect(() => {
    if (!hydrated || resumed.current) return
    resumed.current = true
    if (data.viewer.resume) return
    const local = loadLocalResume(data.chapter.id)
    if (local && local.pageIdx > 0 && local.pageIdx < pageCount) {
      initialPage.current = local.pageIdx
      // Move the ref with the state. It is written during render, so it still holds the old
      // page here — and the `[items]` effect below runs later in this same commit, before any
      // re-render. Without this the resume was immediately overwritten with page 1 while the
      // counter, scrubber and progress bar all read the resumed page: paged readers lost
      // their place and only saw it when the next arrow press jumped to page 2.
      pageRef.current = local.pageIdx
      setPageIdx(local.pageIdx)
      setItemIndexRaw(itemIndexOfPage(items, local.pageIdx))
      setStripKey((k) => k + 1)
    }
  }, [hydrated, data.viewer.resume, data.chapter.id, pageCount, items])

  useEffect(() => {
    setItemIndexRaw(itemIndexOfPage(items, pageRef.current))
  }, [items])

  const setItemIndex = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(items.length - 1, i))
      setItemIndexRaw(clamped)
      setPageIdx(pageOfItem(items, clamped))
      if (items[clamped]?.kind === 'end') setChrome(true)
    },
    [items],
  )

  const progress = paged
    ? items[itemIndex]?.kind === 'end'
      ? 1
      : progressOfPage(pageIdx, pageCount)
    : scrollPct

  // What this device writes down about the chapter, so a signed-out reader's "Continue
  // reading" rail and history can render it with nothing but localStorage to go on.
  const progressContext = useMemo(
    () => ({
      chapterId: data.chapter.id,
      seriesId: data.series.id,
      seriesSlug: data.series.slug,
      seriesTitle: data.series.title,
      seriesHref: data.series.href,
      seriesType: data.series.type,
      coverSrc: data.series.coverSrc,
      chapterNumber: data.chapter.number,
      chapterLabel: data.chapter.label,
      chapterHref: data.chapter.href,
      pageCount,
    }),
    [data.series, data.chapter, pageCount],
  )

  useProgressWriter({
    chapterId: data.chapter.id,
    pageIdx,
    scrollPct: progress,
    signedIn: data.viewer.signedIn,
    context: progressContext,
  })

  // docs/06: at 80% prefetch the next chapter's route and its first three pages.
  useEffect(() => {
    if (prefetched.current || progress < PREFETCH_AT || !data.next || data.next.locked) return
    prefetched.current = true
    router.prefetch(data.next.href)
    if (!data.nextPagesEndpoint) return
    fetch(data.nextPagesEndpoint)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { data?: { pages?: ReaderPage[] } } | null) => {
        for (const page of json?.data?.pages ?? []) {
          const img = new Image()
          img.src = pickVariant(
            page,
            settings.quality,
            mobile ? window.innerWidth : 820,
            window.devicePixelRatio,
          )
        }
      })
      .catch(() => undefined)
  }, [progress, data.next, data.nextPagesEndpoint, router, settings.quality, mobile])

  // Body scroll off while the reader is mounted (belt and braces with the :has() rule).
  useEffect(() => {
    const prev = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = prev
    }
  }, [])

  const srcFor = useCallback(
    (page: ReaderPage, renderedWidth: number) =>
      pickVariant(
        page,
        settings.quality,
        renderedWidth,
        typeof window === 'undefined' ? 1 : window.devicePixelRatio,
      ),
    [settings.quality],
  )

  const setMode = useCallback(
    (mode: ReaderData['defaults']['mode'] | 'single' | 'double') => {
      const next = mode === 'paged' ? 'single' : mode
      if (isPaged(next) === paged) {
        update({ mode: next })
        return
      }
      if (!isPaged(next)) {
        initialPage.current = pageIdx
        setStripKey((k) => k + 1)
      }
      update({ mode: next })
    },
    [paged, pageIdx, update],
  )

  const goPrev = useCallback(
    () => setItemIndex(prevItemIndex(items, itemIndex, settings.mode)),
    [items, itemIndex, settings.mode, setItemIndex],
  )
  const goNext = useCallback(() => {
    if (itemIndex >= items.length - 1) {
      if (data.next && !data.next.locked) router.push(data.next.href)
      return
    }
    setItemIndex(nextItemIndex(items, itemIndex, settings.mode))
  }, [items, itemIndex, settings.mode, setItemIndex, data.next, router])

  const goToPage = useCallback(
    (idx: number) => setItemIndex(itemIndexOfPage(items, idx)),
    [items, setItemIndex],
  )

  const scrollToComments = useCallback(() => {
    const go = () =>
      document.getElementById('comments')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (paged) {
      setItemIndex(items.length - 1)
      window.setTimeout(go, 50)
    } else go()
  }, [paged, items.length, setItemIndex])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void rootRef.current?.requestFullscreen?.()
  }, [])

  // Keyboard (docs/06): ← → space shift+space f s c h ?
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.closest('input,textarea,select,[contenteditable]') || t.closest('dialog'))) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const rtl = settings.direction === 'rtl'
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault()
          const forward = (e.key === 'ArrowRight') !== rtl
          if (paged) forward ? goNext() : goPrev()
          else {
            const link = forward ? data.next : data.prev
            if (link) router.push(link.href)
          }
          return
        }
        case ' ': {
          e.preventDefault()
          if (paged) e.shiftKey ? goPrev() : goNext()
          else {
            const root = scrollRef.current
            if (root)
              root.scrollBy({
                top: (e.shiftKey ? -1 : 1) * root.clientHeight * 0.85,
                behavior: 'smooth',
              })
          }
          return
        }
        case 'f':
        case 'F':
          toggleFullscreen()
          return
        case 's':
        case 'S':
          setMode(paged ? 'strip' : 'single')
          return
        case 'c':
        case 'C':
          scrollToComments()
          return
        case 'h':
        case 'H':
          setChrome((v) => !v)
          return
        case '?':
          setShortcutsOpen(true)
          return
        default:
          return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    paged,
    settings.direction,
    goNext,
    goPrev,
    data.next,
    data.prev,
    router,
    toggleFullscreen,
    setMode,
    scrollToComments,
  ])

  // Strip: hide the chrome on scroll-down, bring it back on scroll-up.
  const onStripScroll = useCallback((s: { pct: number; delta: number; top: number }) => {
    setScrollPct(s.pct)
    if (s.delta > 12 && s.top > 80) setChrome(false)
    else if (s.delta < -12) setChrome(true)
  }, [])

  const topH = paged ? (mobile ? 52 : 48) : mobile ? 52 : 56
  const bottomH = paged && !mobile ? 72 : 60
  const lightInk = isLightBackground(settings.background)
  const counter = fmt(messages.readerUi.counter, { n: pageIdx + 1, total: pageCount })
  const chapterNumber = String(data.chapter.number)

  const end = (
    <EndOfChapter
      chapterNumber={chapterNumber}
      next={data.next}
      seriesHref={data.series.href}
      seriesTitle={data.series.title}
      subscribeHref={data.links.subscribe}
      ads={data.ads}
      mobile={mobile}
      comments={comments}
    />
  )

  return (
    <div
      id="reader-root"
      ref={rootRef}
      data-mode={settings.mode}
      className="fixed inset-0 z-40 overflow-hidden text-fg"
      style={{ background: backgroundStyle(settings.background), overscrollBehavior: 'contain' }}
    >
      <style>{shellCss}</style>
      {/* Signing in from inside the reader (the paywall, the header) lands back here, so
          this is one of the two places the device hands its anonymous reading over. */}
      {data.viewer.userId === null ? null : <MergeDeviceProgress userId={data.viewer.userId} />}
      <ProgressBar pct={progress} top={chrome ? topH : 0} current={pageIdx + 1} total={pageCount} />
      <TopBar
        visible={chrome}
        paged={paged}
        mobile={mobile}
        seriesTitle={data.series.title}
        seriesHref={data.series.href}
        chapterLabel={data.chapter.label}
        compactLabel={fmt(messages.readerUi.chapterCompact, {
          title: data.series.title,
          n: chapterNumber,
        })}
        counter={counter}
        chapters={data.chapters}
        currentChapter={data.chapter.number}
        pageCount={pageCount}
        currentPage={pageIdx}
        onPage={goToPage}
        onSettings={() => setSettingsOpen(true)}
        onComments={scrollToComments}
        onMore={() => setMoreOpen(true)}
        settingsOpen={settingsOpen}
        moreOpen={moreOpen}
        height={topH}
      />

      {paged ? (
        <PagedView
          items={items}
          pages={data.pages}
          itemIndex={itemIndex}
          mode={settings.mode}
          fit={settings.fit}
          direction={settings.direction}
          preload={settings.preload}
          srcFor={srcFor}
          altTemplate={data.chapter.altTemplate}
          lightInk={lightInk}
          ads={data.ads}
          top={chrome ? topH : 0}
          bottom={chrome ? bottomH : 0}
          showTapHint={coarse && !tapHintSeen}
          onDismissTapHint={markTapHint}
          onPrev={goPrev}
          onNext={goNext}
          onToggleChrome={() => setChrome((v) => !v)}
          end={end}
        />
      ) : (
        <div ref={scrollRef} className="absolute inset-0 overflow-y-auto overscroll-contain">
          <StripView
            key={stripKey}
            scrollRef={scrollRef}
            items={items}
            pages={data.pages}
            srcFor={srcFor}
            altTemplate={data.chapter.altTemplate}
            gap={settings.gap}
            lightInk={lightInk}
            ads={data.ads}
            topPad={topH + 3}
            bottomPad={bottomH}
            initialPage={initialPage.current}
            onCurrentPage={setPageIdx}
            onScroll={onStripScroll}
            onToggleChrome={() => setChrome((v) => !v)}
            end={end}
          />
        </div>
      )}

      {paged && !mobile ? (
        <footer
          className={`absolute inset-x-0 bottom-0 z-30 flex flex-col items-center justify-center gap-3 px-6 transition-transform duration-200 motion-reduce:transition-none ${
            chrome ? 'translate-y-0' : 'translate-y-full'
          }`}
          style={{ height: bottomH }}
        >
          <Scrubber
            count={pageCount}
            current={pageIdx}
            onChange={goToPage}
            variant="ticks"
            className="w-full max-w-[605px]"
          />
          <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-fg-muted">
            <Kbd>←</Kbd>
            <Kbd>→</Kbd>
            <span>{messages.readerUi.hintTurn}</span>
            <span className="px-0.5 opacity-50">·</span>
            <Kbd>F</Kbd>
            <span>{messages.readerUi.hintFullscreen}</span>
            <span className="px-0.5 opacity-50">·</span>
            <Kbd>S</Kbd>
            <span>{messages.readerUi.hintStrip}</span>
          </div>
        </footer>
      ) : (
        <BottomBar
          visible={chrome}
          prev={data.prev}
          next={data.next}
          chapters={data.chapters}
          currentChapter={data.chapter.number}
          height={bottomH}
        />
      )}

      {paged && mobile ? (
        <div
          className={`pointer-events-none absolute inset-x-0 z-30 transition-[bottom] duration-200 motion-reduce:transition-none`}
          style={{ bottom: chrome ? bottomH : 0 }}
        >
          <output
            aria-live="polite"
            className="absolute bottom-7 left-1/2 flex h-7 -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-bg/95 px-3 text-sm font-semibold backdrop-blur-[12px]"
          >
            <span>{pageIdx + 1}</span>
            <span className="font-medium text-fg-muted">/</span>
            <span className="font-medium text-fg-muted">{pageCount}</span>
          </output>
          <Scrubber
            count={pageCount}
            current={pageIdx}
            onChange={goToPage}
            variant="thin"
            className="pointer-events-auto absolute inset-x-4 bottom-3"
          />
        </div>
      ) : null}

      <FloatingPill
        visible={!chrome}
        prev={data.prev}
        next={data.next}
        chapters={data.chapters}
        currentChapter={data.chapter.number}
      />
      <ChromeHint visible={!chrome} />
      <Skyscrapers ads={data.ads} />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        update={(patch) => {
          if (patch.mode !== undefined) setMode(patch.mode)
          const { mode: _mode, ...rest } = patch
          if (Object.keys(rest).length) update(rest)
        }}
        subscribeHref={data.links.subscribe}
        showPremium={data.ads.enabled}
      />
      <ShortcutsSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        showShortcuts={!coarse}
        onReport={() => {
          setMoreOpen(false)
          setReportOpen(true)
        }}
        onShortcuts={() => {
          setMoreOpen(false)
          setShortcutsOpen(true)
        }}
      />
      <ReportSheet
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        chapterId={data.chapter.id}
        chapterLabel={data.chapter.labelWithTitle}
        pageIdx={pageIdx}
        pageCount={pageCount}
        signedIn={data.viewer.signedIn}
      />
    </div>
  )
}
