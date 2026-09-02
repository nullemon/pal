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

export const chapterHref = (slug: string, n: number): string =>
  `/series/${slug}/chapter-${formatChapterNumber(n)}`

export const seriesHref = (slug: string): string => `/series/${slug}`
