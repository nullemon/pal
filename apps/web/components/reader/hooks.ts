'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  defaultSettings,
  loadSettings,
  type SettingsDefaults,
  saveLocalResume,
  saveSettings,
} from './settings'
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

export interface ProgressInput {
  chapterId: number
  pageIdx: number
  scrollPct: number
  signedIn: boolean
}

const FLUSH_MS = 5000

/**
 * docs/06 "Progress and offline": the position is written at most once every 5 seconds
 * and once more on `visibilitychange` through `navigator.sendBeacon`. Everyone gets a
 * local resume record; signed-in readers also get the server row.
 */
export function useProgressWriter(input: ProgressInput) {
  const latest = useRef(input)
  const sent = useRef<string>('')
  const timer = useRef<number | null>(null)
  latest.current = input

  const flush = useCallback((beacon: boolean) => {
    const { chapterId, pageIdx, scrollPct } = latest.current
    const body = JSON.stringify({
      chapterId,
      pageIdx,
      scrollPct: Math.round(scrollPct * 1000) / 1000,
    })
    saveLocalResume(latest.current.chapterId, {
      pageIdx: latest.current.pageIdx,
      scrollPct: latest.current.scrollPct,
    })
    if (!latest.current.signedIn || body === sent.current) return
    sent.current = body
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
