import { localResume } from '@/lib/progress/local'
import type { ReaderBackground, ReaderDirection, ReaderMode, ReaderSettings } from './types'

/** localStorage key; bump the suffix when the shape changes incompatibly. */
export const SETTINGS_KEY = 'palscans.reader.v1'

/**
 * The allowed value of every stored preference. A plain table rather than a schema object:
 * this module is imported by the reader island, and a validation library costs 83 KB
 * gzipped in the browser for what is, here, seven `includes` calls (docs/20 "Front-end
 * budgets"). Untrusted *input* is still parsed on the server; this only reads back this
 * device's own localStorage, where the worst case is a stale or hand-edited value.
 */
export const READER_SETTING_VALUES = {
  mode: ['strip', 'single', 'double'],
  direction: ['ltr', 'rtl'],
  fit: ['width', 'height', 'original'],
  quality: ['auto', 'high', 'saver'],
  preload: [3, 5, 10],
  background: ['black', 'dark', 'sepia', 'white'],
  gap: [0, 8, 16],
} as const satisfies { [K in keyof ReaderSettings]: readonly ReaderSettings[K][] }

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
  for (const key of Object.keys(READER_SETTING_VALUES) as Array<keyof ReaderSettings>) {
    const value = (raw as Record<string, unknown>)[key]
    const allowed: readonly unknown[] = READER_SETTING_VALUES[key]
    if (allowed.includes(value)) (out as unknown as Record<string, unknown>)[key] = value
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

/** `{ pageIdx: int ≥ 0, scrollPct: 0…1 }`, or null for anything else. */
export const parseResume = (raw: unknown): { pageIdx: number; scrollPct: number } | null => {
  if (!raw || typeof raw !== 'object') return null
  const { pageIdx, scrollPct } = raw as Record<string, unknown>
  if (typeof pageIdx !== 'number' || !Number.isInteger(pageIdx) || pageIdx < 0) return null
  if (typeof scrollPct !== 'number' || Number.isNaN(scrollPct)) return null
  if (scrollPct < 0 || scrollPct > 1) return null
  return { pageIdx, scrollPct }
}

const legacyResume = (chapterId: number): { pageIdx: number; scrollPct: number } | null => {
  try {
    const raw = window.localStorage.getItem(`${RESUME_KEY}:${chapterId}`)
    return raw ? parseResume(JSON.parse(raw)) : null
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
