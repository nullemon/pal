'use client'

/** Browser-side helpers shared by the art dropzones and the bulk uploader. */

import {
  isImageName as coreIsImageName,
  naturalCompare as coreNaturalCompare,
  createZipGuard,
  detectChapterNumber,
  mimeForName,
  type PlanOptions,
  planDrop,
  type RejectReason,
  sanitizeEntryPath,
  type ZipGuard,
} from '@palscans/core/import'
import { unzip } from 'fflate'

export const sha256Hex = async (blob: Blob): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export interface PutTarget {
  url: string
  headers: Record<string, string>
}

/** PUT with progress and retries (docs/03: a dropped connection retries the file, not the chapter). */
export const uploadWithRetry = (
  url: string,
  headers: Record<string, string>,
  body: Blob,
  onProgress?: (fraction: number) => void,
  attempts = 3,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const attempt = (n: number) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', url)
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total)
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(1)
          resolve()
        } else if (n < attempts && (xhr.status >= 500 || xhr.status === 0)) {
          setTimeout(() => attempt(n + 1), 500 * 2 ** n)
        } else reject(new Error(`PUT ${xhr.status}`))
      }
      xhr.onerror = () => {
        if (n < attempts) setTimeout(() => attempt(n + 1), 500 * 2 ** n)
        else reject(new Error('network'))
      }
      xhr.send(body)
    }
    attempt(1)
  })

export type { PlanOptions, RejectReason }
/**
 * Boundary, order and safety rules live in @palscans/core/import (`bulk.ts`) so they can be
 * tested without a DOM and stay identical everywhere. These re-exports keep the old
 * import sites working.
 */
export { detectChapterNumber, planDrop, sanitizeEntryPath }

/** Natural-order comparator: page2 < page10 (docs/03 step 2). */
export const naturalCompare = coreNaturalCompare

/** Chapter number from a folder / archive name, as a number for the form field. */
export const parseChapterNumber = (name: string): number | null => {
  const detected = detectChapterNumber(name)
  return detected.number === null ? null : Number.parseFloat(detected.number)
}

export const isImageName = coreIsImageName
export const mimeFor = mimeForName

/** Run async tasks with bounded concurrency (4-wide uploads, docs/03 step 5). */
export const runPool = async <T>(
  items: T[],
  width: number,
  fn: (item: T, index: number) => Promise<void>,
) => {
  let next = 0
  const workers = Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      const item = items[i]
      if (item !== undefined) await fn(item, i)
    }
  })
  await Promise.all(workers)
}

export const imageSize = (file: Blob): Promise<{ width: number; height: number } | null> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      resolve(null)
      URL.revokeObjectURL(url)
    }
    img.src = url
  })

export interface ExtractedEntry {
  /** Path relative to the drop, archive stem first: `Series Ch 12/001.jpg`. */
  path: string
  file: File
}

export interface ExtractResult {
  entries: ExtractedEntry[]
  rejected: Array<{ path: string; reason: RejectReason }>
  /** Set when a whole-archive cap tripped: the archive was only partly read. */
  aborted: ZipGuard['aborted']
}

export const archiveStem = (name: string): string =>
  name.replace(/\.(cbz|zip|cbr|rar|7z)$/i, '') || name

/**
 * Unzip in the browser (docs/03: a 400 MB archive never touches the server) behind
 * `createZipGuard` — every entry is judged from the central directory *before* it is
 * inflated, so a bomb, a path escape (`../../etc/passwd`) or a non-image never becomes
 * memory. Entry paths are kept, so `Ch 1/…`, `Ch 2/…` inside one archive stay two chapters.
 */
export const unzipEntries = (file: File): Promise<ExtractResult> =>
  new Promise((resolve, reject) => {
    const guard = createZipGuard()
    const stem = archiveStem(file.name)
    const paths = new Map<string, string>()
    file.arrayBuffer().then((buf) => {
      unzip(
        new Uint8Array(buf),
        {
          filter: (info) => {
            const decision = guard.check(info)
            if (decision.take && decision.path) paths.set(info.name, decision.path)
            return decision.take
          },
        },
        (err, data) => {
          if (err) return reject(err)
          const entries: ExtractedEntry[] = []
          for (const [name, bytes] of Object.entries(data)) {
            const safe = paths.get(name)
            if (!safe) continue
            const base = safe.slice(safe.lastIndexOf('/') + 1)
            entries.push({
              path: `${stem}/${safe}`,
              file: new File([bytes as BlobPart], base, { type: mimeForName(base) ?? '' }),
            })
          }
          resolve({
            entries,
            // `archive · entry`, not a joined path: a rejected entry name is not a path.
            rejected: guard.rejected.map((r) => ({ ...r, path: `${stem} · ${r.path}` })),
            aborted: guard.aborted,
          })
        },
      )
    }, reject)
  })
