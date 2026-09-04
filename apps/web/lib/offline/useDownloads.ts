'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReaderData } from '@/components/reader/types'
import { downloadChapter, removeChapter, storageEstimate } from './cache'
import { listChapters, offlineSupported } from './db'
import type { DownloadProgress, OfflineChapterSummary } from './types'

export type DownloadState =
  | { status: 'idle' }
  | { status: 'working'; progress: DownloadProgress }
  | { status: 'done' }
  | { status: 'error'; message: string }

interface OfflinePayload {
  data: ReaderData
  coverUrl: string | null
}

/**
 * The downloads screen's state: what is stored, how much room it takes, and the ability to
 * add or remove one. Every read is guarded — a browser with storage switched off (Safari
 * private mode) must render an empty, honest screen rather than throw.
 */
export function useDownloads() {
  const [supported, setSupported] = useState(true)
  const [rows, setRows] = useState<OfflineChapterSummary[] | null>(null)
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null)

  const refresh = useCallback(async () => {
    if (!offlineSupported()) {
      setSupported(false)
      setRows([])
      return
    }
    try {
      const [list, estimate] = await Promise.all([listChapters(), storageEstimate()])
      setRows(list)
      setUsage(estimate)
    } catch {
      setSupported(false)
      setRows([])
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const remove = useCallback(
    async (chapterId: number) => {
      await removeChapter(chapterId).catch(() => undefined)
      await refresh()
    },
    [refresh],
  )

  return { supported, rows, usage, refresh, remove }
}

/** True once this chapter is on disk. Used by the Download button to show "Downloaded". */
export function useIsDownloaded(chapterId: number | null) {
  const [downloaded, setDownloaded] = useState<boolean | null>(null)
  const check = useCallback(async () => {
    if (chapterId === null || !offlineSupported()) return setDownloaded(false)
    try {
      const { getChapter } = await import('./db')
      setDownloaded(Boolean(await getChapter(chapterId)))
    } catch {
      setDownloaded(false)
    }
  }, [chapterId])
  useEffect(() => {
    void check()
  }, [check])
  return { downloaded, recheck: check }
}

/**
 * Drive one download: ask the server for the payload (which is where entitlement is
 * enforced), then write the pages. Aborts cleanly if the component unmounts mid-download.
 */
export function useChapterDownload() {
  const [state, setState] = useState<DownloadState>({ status: 'idle' })
  const abort = useRef<AbortController | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  const start = useCallback(async (chapterId: number) => {
    if (!offlineSupported()) {
      setState({ status: 'error', message: 'unsupported' })
      return false
    }
    const controller = new AbortController()
    abort.current = controller
    setState({ status: 'working', progress: { done: 0, total: 0, bytes: 0 } })
    try {
      const res = await fetch(`/api/chapters/${chapterId}/offline`, {
        credentials: 'same-origin',
        signal: controller.signal,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setState({ status: 'error', message: body?.error ?? String(res.status) })
        return false
      }
      const payload = (await res.json()) as { data: OfflinePayload }
      const { data, coverUrl } = payload.data
      await downloadChapter(data, coverUrl, {
        signal: controller.signal,
        onProgress: (progress) => setState({ status: 'working', progress }),
      })
      // Refresh the offline shell so the library page itself is readable with no network.
      navigator.serviceWorker?.controller?.postMessage({ type: 'cache-shell' })
      setState({ status: 'done' })
      return true
    } catch (err) {
      if (controller.signal.aborted) {
        setState({ status: 'idle' })
        return false
      }
      setState({ status: 'error', message: err instanceof Error ? err.message : 'failed' })
      return false
    }
  }, [])

  const cancel = useCallback(() => abort.current?.abort(), [])

  return { state, start, cancel }
}
