import type { ReaderData } from '@/components/reader/types'
import { deleteChapter, getChapter, putChapter } from './db'
import { pinToCachedVariant } from './format'
import type { DownloadProgress, OfflineChapter } from './types'

/**
 * The page half of offline downloads (docs/06). One Cache Storage bucket holds every
 * downloaded image; IndexedDB holds which URLs belong to which chapter, so removing a
 * download deletes exactly its own entries and never a page another download shares.
 */
export const CACHE_NAME = 'palscans-offline-v1'

const sizeOf = async (res: Response): Promise<number> => {
  const declared = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > 0) return declared
  try {
    return (await res.clone().blob()).size
  } catch {
    return 0
  }
}

export interface DownloadOptions {
  onProgress?: (p: DownloadProgress) => void
  signal?: AbortSignal
}

/**
 * Fetch and store every page of a chapter. Resolves with the stored row; throws if any page
 * cannot be fetched, having first removed whatever it had already written — a half-downloaded
 * chapter that claims to be readable offline is worse than no download at all.
 */
export const downloadChapter = async (
  data: ReaderData,
  coverUrl: string | null,
  options: DownloadOptions = {},
): Promise<OfflineChapter> => {
  const pinned = pinToCachedVariant(data)
  const cache = await caches.open(CACHE_NAME)
  const targets = [...pinned.pages.map((p) => p.url), ...(coverUrl ? [coverUrl] : [])]
  const written: string[] = []
  let bytes = 0

  const report = () => options.onProgress?.({ done: written.length, total: targets.length, bytes })
  report()

  try {
    for (const url of targets) {
      if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      const res = await fetch(url, { credentials: 'same-origin', signal: options.signal })
      if (!res.ok) throw new Error(`page fetch failed: ${res.status}`)
      bytes += await sizeOf(res)
      await cache.put(url, res)
      written.push(url)
      report()
    }
  } catch (err) {
    // Roll back: delete only what this attempt wrote.
    await Promise.all(written.map((u) => cache.delete(u).catch(() => false)))
    throw err
  }

  const row: OfflineChapter = {
    chapterId: pinned.chapter.id,
    seriesId: pinned.series.id,
    seriesSlug: pinned.series.slug,
    seriesTitle: pinned.series.title,
    number: pinned.chapter.number,
    label: pinned.chapter.labelWithTitle,
    coverUrl,
    pageCount: pinned.pages.length,
    bytes,
    downloadedAt: Date.now(),
    urls: written,
    data: pinned,
  }
  await putChapter(row)
  return row
}

/** Remove a download's images and its manifest row. Safe to call for an absent chapter. */
export const removeChapter = async (chapterId: number): Promise<void> => {
  const row = await getChapter(chapterId)
  if (row) {
    const cache = await caches.open(CACHE_NAME)
    // Only URLs no *other* download still needs.
    const others = await keptElsewhere(chapterId)
    await Promise.all(
      row.urls.filter((u) => !others.has(u)).map((u) => cache.delete(u).catch(() => false)),
    )
  }
  await deleteChapter(chapterId)
}

const keptElsewhere = async (exceptChapterId: number): Promise<Set<string>> => {
  const { allChapters } = await import('./db')
  const rows = await allChapters()
  const kept = new Set<string>()
  for (const r of rows) {
    if (r.chapterId === exceptChapterId) continue
    for (const u of r.urls) kept.add(u)
  }
  return kept
}

/** Browser storage estimate, for "3 chapters · 48 MB of 2 GB" on the downloads screen. */
export const storageEstimate = async (): Promise<{ usage: number; quota: number } | null> => {
  if (!navigator.storage?.estimate) return null
  const { usage, quota } = await navigator.storage.estimate()
  return { usage: usage ?? 0, quota: quota ?? 0 }
}
