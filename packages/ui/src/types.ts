export type SeriesType = 'manhwa' | 'manhua' | 'manga' | 'comic'
export type SeriesStatus = 'ongoing' | 'completed' | 'hiatus' | 'cancelled'

export interface CoverImage {
  src: string
  width: number
  height: number
  alt?: string
}
