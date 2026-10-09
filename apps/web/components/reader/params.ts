import { DEFAULT_CHAPTER_LANGUAGE } from '@palscans/core/languages'
import { z } from 'zod'

/** `chapter-301` / `chapter-12.5` → 301 / 12.5 (docs/12 §1). Anything else is a 404. */
export const chapterSegmentSchema = z
  .string()
  .regex(/^chapter-\d{1,7}(?:\.\d{1,3})?$/)
  .transform((s) => Number.parseFloat(s.slice('chapter-'.length)))
  .pipe(z.number().finite().nonnegative())

export const parseChapterSegment = (segment: string | undefined): number | null => {
  if (!segment) return null
  const r = chapterSegmentSchema.safeParse(segment)
  return r.success ? r.data : null
}

/** Chapter numbers are numeric(10,3); render without trailing zeros. Client-safe. */
export const formatChapterNumber = (n: number): string => String(Number.parseFloat(n.toFixed(3)))

/**
 * The URL of one chapter, in one language.
 *
 * English carries no parameter at all, so every link that existed before migration 9044 is
 * byte-for-byte what it was: the indexed URLs keep their rankings and nothing redirects.
 * Other languages get `?lang=`, and because prev/next are built through here too, a reader
 * who started in German stays in German without the page having to thread it separately.
 */
export const chapterHref = (slug: string, n: number, language?: string | null): string => {
  const base = `/series/${slug}/chapter-${formatChapterNumber(n)}`
  return !language || language === DEFAULT_CHAPTER_LANGUAGE ? base : `${base}?lang=${language}`
}

export const seriesHref = (slug: string): string => `/series/${slug}`
