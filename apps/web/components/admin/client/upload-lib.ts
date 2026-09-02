'use client'

/** Browser-side helpers shared by the art dropzones and the bulk uploader. */

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

/** Natural-order comparator: page2 < page10 (docs/03 step 2). */
export const naturalCompare = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/** Chapter number from a folder / archive name: "Ch. 154", "chapter-154", "154.5", "c012". */
export const parseChapterNumber = (name: string): number | null => {
  const base = name.replace(/\.(cbz|zip)$/i, '')
  const patterns = [
    /(?:ch(?:apter)?|cap(?:itulo)?|episode|ep)[\s._-]*#?(\d+(?:\.\d+)?)/i,
    /\bc(\d{2,4}(?:\.\d+)?)\b/i,
    /(?:^|[\s_-])(\d+(?:\.\d+)?)(?:$|[\s_-])/,
    /(\d+(?:\.\d+)?)/,
  ]
  for (const p of patterns) {
    const m = p.exec(base)
    if (m?.[1]) {
      const n = Number.parseFloat(m[1])
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

export const isImageName = (name: string): boolean => /\.(jpe?g|png|webp|avif|gif)$/i.test(name)

export const mimeFor = (name: string): string | null => {
  const ext = name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'avif':
      return 'image/avif'
    case 'gif':
      return 'image/gif'
    default:
      return null
  }
}

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
