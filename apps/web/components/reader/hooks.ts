'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { LocalProgress } from '@/lib/progress/local'
import { reconcileLocalProgress, rememberLocalProgress } from '@/lib/progress/local'
import { defaultSettings, loadSettings, type SettingsDefaults, saveSettings } from './settings'
import type { ReaderSettings } from './types'

const subscribeMedia = (query: string) => (onChange: () => void) => {
  const mql = window.matchMedia(query)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

/** `matchMedia` as an external store; the server snapshot is `fallback`. */
export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    subscribeMedia(query),
    () => window.matchMedia(query).matches,
    () => fallback,
  )
}

/** Below `md` (768px): the mobile chrome, in-strip ads and fit-to-width default. */
export const useIsMobile = () => useMediaQuery('(max-width: 767px)')
export const useCoarsePointer = () => useMediaQuery('(pointer: coarse)')

/**
 * Per-device reader settings (docs/06 "Settings sheet"): defaults on the server render,
 * the stored preferences after mount, persisted on every change.
 */
export function useReaderSettings(defaults: SettingsDefaults) {
  const base = defaultSettings(defaults)
  const [settings, setSettings] = useState<ReaderSettings>(base)
  const [hydrated, setHydrated] = useState(false)
  const defaultsRef = useRef(base)
  defaultsRef.current = base

  useEffect(() => {
    setSettings(loadSettings(defaultsRef.current))
    setHydrated(true)
  }, [])

  const update = useCallback((patch: Partial<ReaderSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }, [])

  return { settings, update, hydrated }
}

/** Everything about the chapter the local record needs; constant for the reader's life. */
export type ProgressContext = Omit<LocalProgress, 'pageIdx' | 'scrollPct' | 'updatedAt'>

export interface ProgressInput {
  chapterId: number
  pageIdx: number
  scrollPct: number
  signedIn: boolean
  /** The series and chapter, written down so a signed-out rail can render with no network. */
  context: ProgressContext
}

const FLUSH_MS = 5000

/**
 * docs/06 "Progress and offline": the position is written at most once every 5 seconds and
 * once more on `visibilitychange` through `navigator.sendBeacon`. Everyone gets a local
 * record; signed-in readers also get the server row.
 *
 * Two things beyond the original throttle:
 *
 *   * the local record is now the full one `lib/progress` keeps, so a signed-out reader's
 *     continue-reading rail and history have something to render;
 *   * every server write carries **how long ago the position was observed**, which is what
 *     lets the server refuse a stale one. `observedAt` moves only when the position itself
 *     changes, so a tab left open on page 5 all afternoon still describes the morning —
 *     which is exactly what makes the laptop that read on past it win.
 */
export function useProgressWriter(input: ProgressInput) {
  const latest = useRef(input)
  const sent = useRef<string>('')
  const timer = useRef<number | null>(null)
  const observedAt = useRef(Date.now())
  latest.current = input

  // The clock the server compares against. It advances when the reader moves, not when a
  // flush happens: a beacon fired six hours after the last page turn must still say
  // "six hours ago", or an idle tab would win against a device that read on since. Written
  // from an effect rather than during render, so a render React discards cannot re-date a
  // position the reader never saw.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the position is the trigger, not something the body reads
  useEffect(() => {
    observedAt.current = Date.now()
  }, [input.chapterId, input.pageIdx])

  const flush = useCallback((beacon: boolean) => {
    const { chapterId, pageIdx, scrollPct, context, signedIn } = latest.current
    const at = observedAt.current
    rememberLocalProgress({
      ...context,
      chapterId,
      pageIdx,
      scrollPct: Math.round(scrollPct * 1000) / 1000,
      updatedAt: at,
    })
    if (!signedIn) return
    const body = JSON.stringify({
      chapterId,
      pageIdx,
      scrollPct: Math.round(scrollPct * 1000) / 1000,
      observedAgoMs: Math.max(0, Date.now() - at),
    })
    // The dedupe key deliberately leaves the age out: two identical positions are the same
    // write however long apart, and re-sending one would only refresh a timestamp the
    // server is entitled to treat as unchanged.
    const dedupe = `${chapterId}:${pageIdx}:${Math.round(scrollPct * 1000)}`
    if (dedupe === sent.current) return
    sent.current = dedupe
    // A refused write answers 200 with the position that beat it. Nothing is done with it
    // on purpose: yanking the viewport to wherever another device got to, mid-page, would
    // be worse than the stale pointer this rule exists to prevent. The reader's next page
    // turn is a fresh observation and wins on its own merits.
    if (beacon && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/progress', new Blob([body], { type: 'application/json' }))
      return
    }
    void fetch('/api/progress', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined)
  }, [])

  // Trailing-edge throttle: a change of page schedules one write, at most every 5s.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pageIdx is the trigger, the body reads the latest values through a ref
  useEffect(() => {
    if (timer.current !== null) return
    timer.current = window.setTimeout(() => {
      timer.current = null
      flush(false)
    }, FLUSH_MS)
  }, [input.pageIdx, flush])

  // Anything the journal saved during a previous `pagehide` that IndexedDB never committed
  // is written down now, while there is time (see lib/progress/local.ts).
  useEffect(() => {
    void reconcileLocalProgress()
  }, [])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onVisibility)
      if (timer.current !== null) window.clearTimeout(timer.current)
      flush(true)
    }
  }, [flush])
}

/** A boolean that persists once set, e.g. "has this device seen the tap-zone hint". */
export function useOnceFlag(key: string): [boolean, () => void] {
  const [seen, setSeen] = useState(true)
  useEffect(() => {
    try {
      setSeen(window.localStorage.getItem(key) === '1')
    } catch {
      setSeen(true)
    }
  }, [key])
  const mark = useCallback(() => {
    setSeen(true)
    try {
      window.localStorage.setItem(key, '1')
    } catch {
      // ignore
    }
  }, [key])
  return [seen, mark]
}
