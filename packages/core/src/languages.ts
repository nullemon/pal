/**
 * Chapter languages (migration 9044).
 *
 * A curated list rather than free text or the full ISO set. Free text turns into "German",
 * "german", "Deutsch" and "de" as four languages the moment more than one person uploads, and
 * the reader's language switcher is then unusable. The full ISO list is 180-odd entries in a
 * dropdown an uploader has to scroll past every time.
 *
 * Codes are the BCP-47 tag, and the two that carry a region do so because the scripts are not
 * interchangeable to a reader: `pt-BR` and `zh-Hant` are separate entries, not variants.
 */
export interface ChapterLanguage {
  code: string
  /** Shown in the admin dropdown. */
  label: string
  /** Shown to readers — the language's own name, which is what a reader scanning for it sees. */
  native: string
}

export const CHAPTER_LANGUAGES: readonly ChapterLanguage[] = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)', native: 'Português (BR)' },
  { code: 'pt', label: 'Portuguese', native: 'Português' },
  { code: 'fr', label: 'French', native: 'Français' },
  { code: 'de', label: 'German', native: 'Deutsch' },
  { code: 'it', label: 'Italian', native: 'Italiano' },
  { code: 'ru', label: 'Russian', native: 'Русский' },
  { code: 'pl', label: 'Polish', native: 'Polski' },
  { code: 'tr', label: 'Turkish', native: 'Türkçe' },
  { code: 'ar', label: 'Arabic', native: 'العربية' },
  { code: 'id', label: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'vi', label: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'th', label: 'Thai', native: 'ไทย' },
  { code: 'fil', label: 'Filipino', native: 'Filipino' },
  { code: 'ja', label: 'Japanese', native: '日本語' },
  { code: 'ko', label: 'Korean', native: '한국어' },
  { code: 'zh', label: 'Chinese (Simplified)', native: '简体中文' },
  { code: 'zh-Hant', label: 'Chinese (Traditional)', native: '繁體中文' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'uk', label: 'Ukrainian', native: 'Українська' },
  { code: 'nl', label: 'Dutch', native: 'Nederlands' },
] as const

/**
 * What a chapter is in when nobody said otherwise — and what every chapter uploaded before
 * migration 9044 is, so existing URLs and existing rows mean exactly what they did before.
 */
export const DEFAULT_CHAPTER_LANGUAGE = 'en'

const BY_CODE = new Map(CHAPTER_LANGUAGES.map((l) => [l.code, l]))

export const isChapterLanguage = (value: unknown): value is string =>
  typeof value === 'string' && BY_CODE.has(value)

export const chapterLanguage = (code: string | null | undefined): ChapterLanguage =>
  BY_CODE.get(code ?? '') ??
  BY_CODE.get(DEFAULT_CHAPTER_LANGUAGE) ?? {
    code: DEFAULT_CHAPTER_LANGUAGE,
    label: 'English',
    native: 'English',
  }

/**
 * Normalise an incoming tag to one on the list, or fall back to the default.
 *
 * Case and separator are forgiving (`PT-br`, `pt_BR`) because these arrive from an API client
 * or a hand-typed form as often as from the dropdown. Anything unrecognised becomes the
 * default rather than an error: a chapter in the wrong language is fixable from the panel,
 * a refused upload at 3am is not.
 */
export const normaliseLanguage = (value: string | null | undefined): string => {
  if (!value) return DEFAULT_CHAPTER_LANGUAGE
  const cleaned = value.trim().replace(/_/g, '-')
  if (BY_CODE.has(cleaned)) return cleaned
  const lower = cleaned.toLowerCase()
  for (const lang of CHAPTER_LANGUAGES) if (lang.code.toLowerCase() === lower) return lang.code
  // `de-AT` and `de-DE` are both German as far as a chapter list is concerned.
  const base = lower.split('-')[0]
  for (const lang of CHAPTER_LANGUAGES) if (lang.code.toLowerCase() === base) return lang.code
  return DEFAULT_CHAPTER_LANGUAGE
}

/**
 * The language a reader should land on, given what a series actually has.
 *
 * Their preference wins when that language exists for this series; otherwise English if it is
 * there, otherwise whatever the series has most of — which is passed in already ordered. The
 * point is that a series with no German chapters shows something rather than an empty list.
 */
export const resolveReaderLanguage = (
  available: readonly string[],
  preferred: string | null | undefined,
): string => {
  if (available.length === 0) return DEFAULT_CHAPTER_LANGUAGE
  if (preferred && available.includes(preferred)) return preferred
  if (available.includes(DEFAULT_CHAPTER_LANGUAGE)) return DEFAULT_CHAPTER_LANGUAGE
  return available[0] ?? DEFAULT_CHAPTER_LANGUAGE
}
