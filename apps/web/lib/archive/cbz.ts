import { Zip, ZipPassThrough } from 'fflate'

/**
 * CBZ assembly (docs/06 "Progress and offline" — the *other* download).
 *
 * A CBZ is a ZIP of page images in reading order, which is what every reader app on a
 * phone or desktop opens. Nothing here compresses: AVIF and WebP pages are already
 * compressed, so deflating them costs CPU for a fraction of a percent, and `store` keeps
 * the route cheap enough to stream under load.
 *
 * The module is pure — it takes named entries and a way to read each one — so the archive
 * can be assembled and unzipped in a test without a database, storage or a request.
 */

/** ZIP stores DOS timestamps, which cannot express a date outside this window. */
export const ZIP_EPOCH = new Date(Date.UTC(1980, 0, 1))
const ZIP_MAX = new Date(Date.UTC(2099, 11, 31))

export const clampZipDate = (date?: Date | null): Date => {
  if (!date || Number.isNaN(date.getTime())) return ZIP_EPOCH
  if (date < ZIP_EPOCH) return ZIP_EPOCH
  if (date > ZIP_MAX) return ZIP_MAX
  return date
}

/** One file in the archive. `read` is called once, only when the stream is ready for it. */
export interface CbzEntry {
  name: string
  read: () => Promise<Uint8Array | null>
}

export interface ChapterArchiveMeta {
  seriesTitle: string
  seriesSlug: string
  /** Formatted chapter number, e.g. `304` or `12.5`. */
  number: string
  chapterTitle: string | null
  pageCount: number
  readingDirection: 'ltr' | 'rtl' | 'vertical'
  /** Canonical URL of the chapter — the reason the archive is worth handing out. */
  url: string
  siteName: string
}

const EXT = /\.([a-z0-9]{1,5})$/i

/**
 * `0001.webp` — zero-padded to the page count so a reader that sorts entries by name shows
 * them in reading order, which is how nearly all of them decide page order. The extension
 * is carried over from the object key so the archive says what the bytes actually are.
 */
export const cbzEntryName = (idx: number, key: string, total: number): string => {
  const ext = EXT.exec(key)?.[1]?.toLowerCase() ?? 'jpg'
  const width = Math.max(3, String(Math.max(total, 1)).length)
  return `${String(idx + 1).padStart(width, '0')}.${ext}`
}

/**
 * Strip anything a filesystem or a Content-Disposition header would choke on. A single dot
 * survives because chapter 12.5 exists; runs of them do not, so no name can read as a path
 * traversal on whatever machine the file lands.
 */
export const archiveFileName = (meta: Pick<ChapterArchiveMeta, 'seriesSlug' | 'number'>): string =>
  `${meta.seriesSlug}-ch-${meta.number}`
    .replace(/\.{2,}/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120) || 'chapter'

const xml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * ComicInfo.xml — the metadata file every CBZ reader looks for. It costs a few hundred
 * bytes and it is the whole point of the feature: the archive carries the series, the
 * chapter and a link back here, so a file that gets passed around still says where it came
 * from. `Manga` also tells the reader to page right-to-left where that is correct.
 */
export const comicInfoXml = (meta: ChapterArchiveMeta): string => {
  const manga = meta.readingDirection === 'rtl' ? 'YesAndRightToLeft' : 'Yes'
  const title = meta.chapterTitle
    ? `Chapter ${meta.number} · ${meta.chapterTitle}`
    : `Chapter ${meta.number}`
  return `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Series>${xml(meta.seriesTitle)}</Series>
  <Number>${xml(meta.number)}</Number>
  <Title>${xml(title)}</Title>
  <PageCount>${meta.pageCount}</PageCount>
  <Manga>${manga}</Manga>
  <Web>${xml(meta.url)}</Web>
  <Notes>Downloaded from ${xml(meta.siteName)} — ${xml(meta.url)}</Notes>
</ComicInfo>
`
}

export interface CbzStreamOptions {
  /**
   * Timestamp written into every entry. Defaults to the start of the ZIP epoch, which is
   * the earliest a ZIP can express, so an archive of the same chapter is byte-identical
   * whenever it is built. Callers usually pass the chapter's publish date instead.
   */
  mtime?: Date
  /** Called once if an entry cannot be read, before the stream errors. */
  onMissing?: (name: string) => void
}

/**
 * The archive as a `ReadableStream`, one entry in flight at a time.
 *
 * `pull` is the whole design: the runtime asks for more bytes only once what we already
 * handed it has been written to the socket, and each pull reads exactly one page. A 60-page
 * chapter at 1440px therefore costs one page of memory per request instead of the whole
 * archive — which is the difference between this route being survivable under load and
 * being a way to run the server out of memory.
 */
export const cbzStream = (
  entries: readonly CbzEntry[],
  options: CbzStreamOptions = {},
): ReadableStream<Uint8Array> => {
  // ZIP timestamps only span 1980-2099; anything outside makes fflate throw.
  const mtime = clampZipDate(options.mtime)
  let zip: Zip
  let next = 0
  let ended = false
  return new ReadableStream<Uint8Array>({
    start(controller) {
      zip = new Zip((err, chunk, final) => {
        if (err) {
          controller.error(err)
          return
        }
        if (chunk?.length) controller.enqueue(chunk)
        if (final) controller.close()
      })
    },
    async pull(controller) {
      if (ended) return
      const entry = entries[next]
      if (!entry) {
        ended = true
        zip.end()
        return
      }
      next += 1
      let data: Uint8Array | null
      try {
        data = await entry.read()
      } catch (err) {
        ended = true
        controller.error(err)
        return
      }
      // A reader who cancels a large download lands here: the page finished loading after
      // `cancel()` already terminated the zip, and adding to it would throw inside `pull`.
      if (ended) return
      if (!data) {
        ended = true
        options.onMissing?.(entry.name)
        controller.error(new Error(`missing archive entry: ${entry.name}`))
        return
      }
      const file = new ZipPassThrough(entry.name)
      file.mtime = mtime
      zip.add(file)
      file.push(data, true)
    },
    cancel() {
      ended = true
      try {
        zip.terminate()
      } catch {
        // the stream was already finished
      }
    },
  })
}

export interface ChapterArchiveInput extends ChapterArchiveMeta {
  /** Page object keys in reading order. */
  keys: readonly string[]
  read: (key: string) => Promise<Uint8Array | null>
}

/**
 * The entries of one chapter's CBZ: every page in reading order, then `ComicInfo.xml`.
 *
 * The metadata goes last on purpose — a reader that has no idea what ComicInfo.xml is and
 * simply takes the first entry as the cover still gets page 1.
 */
export const chapterArchiveEntries = (input: ChapterArchiveInput): CbzEntry[] => {
  const total = input.keys.length
  const pages = input.keys.map((key, idx) => ({
    name: cbzEntryName(idx, key, total),
    read: () => input.read(key),
  }))
  const info = new TextEncoder().encode(comicInfoXml({ ...input, pageCount: total }))
  return [...pages, { name: 'ComicInfo.xml', read: async () => info }]
}
