import type { ReaderData } from '@/components/reader/types'

/** What a downloaded chapter looks like on disk (IndexedDB `downloads` store). */
export interface OfflineChapter {
  /** Primary key. */
  chapterId: number
  seriesId: number
  seriesSlug: string
  seriesTitle: string
  number: number
  label: string
  /** Cached alongside the pages so the list renders without the network. */
  coverUrl: string | null
  pageCount: number
  /** Sum of the cached responses, for the storage figure on the downloads screen. */
  bytes: number
  /** Epoch millis. */
  downloadedAt: number
  /** Exactly the URLs put in the Cache Storage bucket, so removal is precise. */
  urls: string[]
  /** The reader payload, replayed offline by `/offline`. */
  data: ReaderData
}

/** The row the downloads screen renders — everything but the heavy `data`. */
export type OfflineChapterSummary = Omit<OfflineChapter, 'data' | 'urls'>

export interface DownloadProgress {
  done: number
  total: number
  bytes: number
}
