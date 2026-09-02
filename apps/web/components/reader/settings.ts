import { z } from 'zod'
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

/** Background swatch → CSS colour. The dark swatch is the site background token. */
export const backgroundStyle = (bg: ReaderBackground): string => {
  switch (bg) {
    case 'black':
      return '#000000'
    case 'sepia':
      return '#f1e4c8'
    case 'white':
      return '#ffffff'
    default:
      return 'var(--color-bg-deep)'
  }
}

/** Sepia and white backgrounds need dark page-number ink. */
export const isLightBackground = (bg: ReaderBackground): boolean => bg === 'sepia' || bg === 'white'

/** The per-chapter resume record kept for everyone, signed in or not. */
export const RESUME_KEY = 'palscans.reader.resume.v1'

export const resumeSchema = z.object({
  pageIdx: z.number().int().min(0),
  scrollPct: z.number().min(0).max(1),
})

export const loadLocalResume = (
  chapterId: number,
): { pageIdx: number; scrollPct: number } | null => {
  try {
    const raw = window.localStorage.getItem(`${RESUME_KEY}:${chapterId}`)
    if (!raw) return null
    const r = resumeSchema.safeParse(JSON.parse(raw))
    return r.success ? r.data : null
  } catch {
    return null
  }
}

export const saveLocalResume = (
  chapterId: number,
  value: { pageIdx: number; scrollPct: number },
) => {
  try {
    window.localStorage.setItem(`${RESUME_KEY}:${chapterId}`, JSON.stringify(value))
  } catch {
    // ignore
  }
}

/** The first-run tap-zone overlay is shown once per device. */
export const TAP_HINT_KEY = 'palscans.reader.tapHint.v1'
