import type { SeriesStatus, SeriesType } from '@palscans/ui'

/**
 * Static sample catalog from design/mockups/BRIEF.md, used only by the placeholder home
 * page until P1 wires the real query helpers. Covers live in /public/dev-covers.
 */
export interface SampleSeries {
  rank: number
  title: string
  slug: string
  type: SeriesType
  status: SeriesStatus
  rating: number
  latestChapter: number
  /** ISO timestamp derived from the brief's relative time, anchored to the build date. */
  updatedAt: string
  cover: string
}

const anchor = Date.UTC(2026, 8, 2, 12, 0, 0)
const ago = (ms: number) => new Date(anchor - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

function entry(
  rank: number,
  title: string,
  type: SeriesType,
  status: SeriesStatus,
  rating: number,
  latestChapter: number,
  updatedAgoMs: number,
): SampleSeries {
  return {
    rank,
    title,
    slug: title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, ''),
    type,
    status,
    rating,
    latestChapter,
    updatedAt: ago(updatedAgoMs),
    cover: `/dev-covers/cover-${String(rank).padStart(2, '0')}.svg`,
  }
}

export const sampleCatalog: readonly SampleSeries[] = [
  entry(1, 'Return of the Frost Monarch', 'manhwa', 'ongoing', 9.6, 301, 12 * MIN),
  entry(2, 'Ashfall Regent', 'manhwa', 'ongoing', 9.4, 154, 1 * HOUR),
  entry(3, 'Solo Cartographer', 'manhwa', 'ongoing', 9.3, 132, 3 * HOUR),
  entry(4, 'The Villainess Keeps the Receipts', 'manhwa', 'ongoing', 9.2, 96, 5 * HOUR),
  entry(5, 'The Ninth Sword Saint', 'manhwa', 'ongoing', 9.1, 88, 8 * HOUR),
  entry(6, 'Overgrowth', 'manga', 'completed', 9.0, 120, 1 * DAY),
  entry(7, 'Dawnbreaker Guild', 'manhwa', 'ongoing', 9.0, 178, 1 * DAY),
  entry(8, 'Ironclad Heir', 'manhwa', 'ongoing', 8.9, 141, 2 * DAY),
  entry(9, 'Gilded Dungeon Broker', 'manhwa', 'ongoing', 8.9, 67, 2 * DAY),
  entry(10, 'Crown of Static', 'manhwa', 'ongoing', 8.8, 59, 3 * DAY),
  entry(11, 'Blood-Iron Academy', 'manhwa', 'ongoing', 8.7, 212, 3 * DAY),
  entry(12, 'Whisper Engine', 'manga', 'completed', 8.7, 38, 4 * DAY),
  entry(13, 'Ten Thousand Year Apprentice', 'manhua', 'ongoing', 8.6, 402, 5 * DAY),
  entry(14, 'Lantern Fox Chronicles', 'manhua', 'ongoing', 8.5, 190, 6 * DAY),
  entry(15, 'Ruin Diver', 'manga', 'ongoing', 8.4, 73, 7 * DAY),
  entry(16, 'Saint of the Rusted Cathedral', 'manhua', 'hiatus', 8.2, 45, 14 * DAY),
]
