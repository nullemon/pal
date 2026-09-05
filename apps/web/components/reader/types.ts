/**
 * Serialisable data the server page hands to the reader island. Everything here crosses
 * the RSC boundary, so: no Dates (ISO strings), no functions, no class instances.
 */

export type ReaderMode = 'strip' | 'single' | 'double'
export type ReaderDirection = 'ltr' | 'rtl'
export type ReaderFit = 'width' | 'height' | 'original'
export type ReaderQuality = 'auto' | 'high' | 'saver'
export type ReaderPreload = 3 | 5 | 10
export type ReaderBackground = 'black' | 'dark' | 'sepia' | 'white'
export type ReaderGap = 0 | 8 | 16

export interface ReaderSettings {
  mode: ReaderMode
  direction: ReaderDirection
  fit: ReaderFit
  quality: ReaderQuality
  preload: ReaderPreload
  background: ReaderBackground
  gap: ReaderGap
}

export interface PageVariantUrl {
  /** Encoded width in CSS pixels of the source. */
  w: number
  url: string
}

export interface ReaderPage {
  idx: number
  width: number
  height: number
  blurHash: string | null
  /** The original object, used when no width variant fits. */
  url: string
  /** Width variants, ascending by `w`. Empty when the chapter has not been processed yet. */
  variants: PageVariantUrl[]
}

export interface ChapterLink {
  number: number
  label: string
  href: string
  locked: boolean
}

export interface ReaderAds {
  /** False when the viewer holds `no_ads` — nothing is rendered at all. */
  enabled: boolean
  skyscrapers: boolean
  skySize: { w: 160 | 300; h: 600 }
  /** 0 = off. */
  mobileInterval: 0 | 2 | 4 | 6
  endSlot: boolean
  /** Draw the dashed placeholder (no network tag configured yet). */
  placeholder: boolean
  /**
   * The network's tag per reader slot, from `Admin → Business → Ads`. Null leaves the box
   * reserved and empty, which is the state before a network is signed up.
   */
  tags: { sky: string | null; instrip: string | null; end: string | null }
}

export interface ReaderResume {
  pageIdx: number
  scrollPct: number
}

export interface ReaderData {
  series: {
    id: number
    slug: string
    title: string
    href: string
    readingDirection: 'ltr' | 'rtl' | 'vertical'
  }
  chapter: {
    id: number
    number: number
    /** "Chapter 301" */
    label: string
    /** "Chapter 301 · The winter gate" when the chapter has a title. */
    labelWithTitle: string
    title: string | null
    href: string
    /** Alt text template with `{n}` left for the page number. */
    altTemplate: string
  }
  pages: ReaderPage[]
  prev: ChapterLink | null
  next: ChapterLink | null
  chapters: ChapterLink[]
  defaults: {
    mode: 'strip' | 'paged'
    background: ReaderBackground
  }
  ads: ReaderAds
  viewer: {
    signedIn: boolean
    resume: ReaderResume | null
  }
  links: {
    subscribe: string
    signIn: string
  }
  /** Prefetch source for the next chapter's first pages (docs/06: at 80%). */
  nextPagesEndpoint: string | null
}
