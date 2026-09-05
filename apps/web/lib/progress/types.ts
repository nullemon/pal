/**
 * A reading position held on the reader's own device. Signed in or not, this is what the
 * browser remembers; for a signed-in reader it is a cache in front of the account row, for
 * a signed-out one it is the only copy there is.
 *
 * It carries enough of the series and chapter to render "Continue reading" and the history
 * list with no network at all — an anonymous reader has no account row to join against, so
 * anything the list needs has to be written down when the chapter is read.
 */
export interface LocalProgress {
  /** Primary key. */
  chapterId: number
  seriesId: number
  seriesSlug: string
  seriesTitle: string
  seriesHref: string
  /** `manga` | `manhwa` | … — the card's type chip. */
  seriesType: string
  /** Public cover URL, stored so the rail renders offline. Null when the series has none. */
  coverSrc: string | null
  chapterNumber: number
  chapterLabel: string
  chapterHref: string
  pageIdx: number
  pageCount: number
  scrollPct: number
  /** Epoch millis, from the device clock, when the reader was last on this position. */
  updatedAt: number
}

/** One entry of the local "Continue reading" rail: the newest position in each series. */
export type LocalContinueEntry = LocalProgress

export const MAX_LOCAL_ROWS = 500
