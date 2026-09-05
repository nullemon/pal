import { type ChapterLabelStyle, chapterLabel, compactNumber } from './time.js'

export type { ChapterLabelStyle }

/**
 * Appearance → Formatting (docs/15 "Formatting"): the five choices that decide how a
 * timestamp, a number and a chapter number are written on the public site.
 *
 * Dependency-free on purpose, and exported from `@palscans/core/formatting` rather than the
 * package root. `packages/ui` reads it from a client component, and the root barrel reaches
 * `watermark.ts` — which imports zod. Pulling the barrel into the reader's bundle is the
 * 83.6 KB mistake docs/20 "What was in there" is about; a subpath that imports only
 * `time.js` cannot make it again.
 *
 * Every default here reproduces exactly what the site rendered before the setting existed,
 * so an operator who never opens the screen sees no change at all:
 *
 * - `relativeTimes: 'both'` is today's `<time>`: a relative phrase with the date on hover.
 * - `clock: '24h'` only shows up in `absolute` mode, where a time of day is actually drawn.
 *   The hover title stays the bare `YYYY-MM-DD` it has always been.
 * - `numbers: 'compact'` is `compactNumber`; `chapterLabel: 'short'` is "Ch. 301";
 *   `weekStartsOn: 'monday'` is the release calendar's hard-coded Monday.
 */

export const FORMATTING_SETTING_KEY = 'formatting'

export const RELATIVE_TIME_MODES = ['relative', 'absolute', 'both'] as const
export type RelativeTimeMode = (typeof RELATIVE_TIME_MODES)[number]

export const CLOCK_FORMATS = ['12h', '24h'] as const
export type ClockFormat = (typeof CLOCK_FORMATS)[number]

export const NUMBER_FORMATS = ['compact', 'grouped'] as const
export type NumberFormat = (typeof NUMBER_FORMATS)[number]

export const CHAPTER_LABEL_STYLES = ['short', 'long', 'hash'] as const

export const WEEK_STARTS = ['monday', 'sunday'] as const
export type WeekStart = (typeof WEEK_STARTS)[number]

export interface FormattingSettings {
  /** "12 min ago" · an absolute date · both (relative, absolute on hover). */
  relativeTimes: RelativeTimeMode
  clock: ClockFormat
  /** 81.3K · 81,300. */
  numbers: NumberFormat
  /** "Ch. 301" · "Chapter 301" · "#301". */
  chapterLabel: ChapterLabelStyle
  weekStartsOn: WeekStart
}

export const DEFAULT_FORMATTING: FormattingSettings = Object.freeze({
  relativeTimes: 'both',
  clock: '24h',
  numbers: 'compact',
  chapterLabel: 'short',
  weekStartsOn: 'monday',
})

const oneOf = <T extends string>(allowed: readonly T[], raw: unknown, fallback: T): T =>
  typeof raw === 'string' && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback

/**
 * Coerce a stored row into the document, field by field. Never throws and never returns a
 * hole: a row written by an older shape, a hand-edited jsonb value or `null` all come back
 * as the shipped defaults for whatever they do not carry.
 */
export const parseFormatting = (raw: unknown): FormattingSettings => {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    relativeTimes: oneOf(RELATIVE_TIME_MODES, o.relativeTimes, DEFAULT_FORMATTING.relativeTimes),
    clock: oneOf(CLOCK_FORMATS, o.clock, DEFAULT_FORMATTING.clock),
    numbers: oneOf(NUMBER_FORMATS, o.numbers, DEFAULT_FORMATTING.numbers),
    chapterLabel: oneOf(CHAPTER_LABEL_STYLES, o.chapterLabel, DEFAULT_FORMATTING.chapterLabel),
    weekStartsOn: oneOf(WEEK_STARTS, o.weekStartsOn, DEFAULT_FORMATTING.weekStartsOn),
  }
}

/** Thousands separators without Intl: the site is English-only and this is hot-path text. */
const groupDigits = (n: number): string => {
  const sign = n < 0 ? '-' : ''
  const digits = String(Math.abs(n))
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ','
    out += digits[i]
  }
  return `${sign}${out}`
}

/** 81_300 → "81.3K" (compact) or "81,300" (grouped). Non-finite input renders as "0". */
export const formatCount = (n: number, mode: NumberFormat = DEFAULT_FORMATTING.numbers): string => {
  if (!Number.isFinite(n)) return '0'
  const value = Math.trunc(n)
  return mode === 'grouped' ? groupDigits(value) : compactNumber(value)
}

export const formatChapterLabel = (
  n: number | string,
  style: ChapterLabelStyle = DEFAULT_FORMATTING.chapterLabel,
): string => chapterLabel(n, style)

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

const pad = (n: number) => String(n).padStart(2, '0')

/** The bare date the `<time title>` has always carried: `2026-09-05`, in UTC. */
export const formatIsoDate = (date: Date): string => date.toISOString().slice(0, 10)

export const formatTimeOfDay = (
  date: Date,
  clock: ClockFormat = DEFAULT_FORMATTING.clock,
): string => {
  const h = date.getHours()
  const m = pad(date.getMinutes())
  if (clock === '24h') return `${pad(h)}:${m}`
  const suffix = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m} ${suffix}`
}

/**
 * A full stamp in the *viewer's* timezone: "5 Sep 2026, 14:32" or "5 Sep 2026, 2:32 PM".
 * Only rendered in `absolute` mode, and only after hydration — the server render stays the
 * timezone-free `formatIsoDate`, so nothing here can produce a hydration mismatch.
 */
export const formatStamp = (date: Date, clock: ClockFormat = DEFAULT_FORMATTING.clock): string => {
  const day = date.getDate()
  const month = MONTHS[date.getMonth()] ?? ''
  const year = date.getFullYear()
  return `${day} ${month} ${year}, ${formatTimeOfDay(date, clock)}`
}

/** `Date#getDay()` value the week starts on: Monday is 1, Sunday is 0. */
export const weekStartIndex = (
  weekStartsOn: WeekStart = DEFAULT_FORMATTING.weekStartsOn,
): number => (weekStartsOn === 'sunday' ? 0 : 1)
