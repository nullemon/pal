import { z } from 'zod'
import { localResume } from '@/lib/progress/local'
import type { ReaderBackground, ReaderDirection, ReaderMode, ReaderSettings } from './types'

/** localStorage key; bump the suffix when the shape changes incompatibly. */
export const SETTINGS_KEY = 'palscans.reader.v1'

export const readerSettingsSchema = z.object({
  mode: z.enum(['strip', 'single', 'double']),
  direction: z.enum(['ltr', 'rtl']),
  fit: z.enum(['width', 'height', 'original']),
  quality: z.enum(['auto', 'high', 'saver']),
  preload: z.union([z.literal(3), z.literal(5), z.literal(10)]),
  background: z.enum(['black', 'dark', 'sepia', 'white']),
  gap: z.union([z.literal(0), z.literal(8), z.literal(16)]),
})

export interface SettingsDefaults {
  /** Admin default from `settings.layouts.reader.default_mode`. */
  mode: 'strip' | 'paged'
  /** From the series' reading direction: manga defaults to right-to-left. */
  direction: ReaderDirection
  background: ReaderBackground
  /** Fit-to-height on desktop, fit-to-width on mobile (docs/06). */
  narrow: boolean
}

export const defaultSettings = (d: SettingsDefaults): ReaderSettings => ({
  mode: d.mode === 'paged' ? 'single' : 'strip',
  direction: d.direction,
  fit: d.narrow ? 'width' : 'height',
  quality: 'auto',
  preload: 5,
  background: d.background,
  gap: 0,
})

/**
 * Merge a stored blob over the defaults, field by field, so a single bad value (or an
 * older shape) never throws the whole preference set away.
 */
export const parseStoredSettings = (raw: unknown, defaults: ReaderSettings): ReaderSettings => {
  if (!raw || typeof raw !== 'object') return defaults
  const out: ReaderSettings = { ...defaults }
  const shape = readerSettingsSchema.shape
  for (const key of Object.keys(shape) as Array<keyof ReaderSettings>) {
    const value = (raw as Record<string, unknown>)[key]
    const r = shape[key].safeParse(value)
    if (r.success) (out as unknown as Record<string, unknown>)[key] = r.data
  }
  return out
}

export const loadSettings = (defaults: ReaderSettings): ReaderSettings => {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    return raw ? parseStoredSettings(JSON.parse(raw), defaults) : defaults
  } catch {
    return defaults
  }
}

export const saveSettings = (settings: ReaderSettings): void => {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // private mode / quota — the sheet still works for the session
  }
}

export const isPaged = (mode: ReaderMode): boolean => mode !== 'strip'

/** Background swatch → CSS colour (the `--color-reader-*` tokens in globals.css). */
export const backgroundStyle = (bg: ReaderBackground): string => {
  switch (bg) {
    case 'black':
      return 'var(--color-reader-black)'
    case 'sepia':
      return 'var(--color-reader-sepia)'
    case 'white':
      return 'var(--color-reader-white)'
    default:
      return 'var(--color-reader-dark)'
  }
}

/** Sepia and white backgrounds need dark page-number ink. */
export const isLightBackground = (bg: ReaderBackground): boolean => bg === 'sepia' || bg === 'white'

/**
 * The per-chapter resume record kept for everyone, signed in or not.
 *
 * The record itself now lives in `lib/progress` — the same rows that feed a signed-out
 * reader's "Continue reading" rail and history, and that are handed to the account when
 * they sign in. This key is only read, never written: it is what an earlier version of the
 * reader wrote, and dropping it silently would move a returning reader back to page one.
 */
export const RESUME_KEY = 'palscans.reader.resume.v1'

export const resumeSchema = z.object({
  pageIdx: z.number().int().min(0),
  scrollPct: z.number().min(0).max(1),
})

const legacyResume = (chapterId: number): { pageIdx: number; scrollPct: number } | null => {
  try {
    const raw = window.localStorage.getItem(`${RESUME_KEY}:${chapterId}`)
    if (!raw) return null
    const r = resumeSchema.safeParse(JSON.parse(raw))
    return r.success ? r.data : null
  } catch {
    return null
  }
}

/** Synchronous, for the reader's first paint: the journal, then the old per-chapter key. */
export const loadLocalResume = (
  chapterId: number,
): { pageIdx: number; scrollPct: number } | null => {
  const row = localResume(chapterId)
  return row ? { pageIdx: row.pageIdx, scrollPct: row.scrollPct } : legacyResume(chapterId)
}

/** The first-run tap-zone overlay is shown once per device. */
export const TAP_HINT_KEY = 'palscans.reader.tapHint.v1'
