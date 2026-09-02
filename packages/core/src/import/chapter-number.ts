/**
 * Parsing the legacy chapter display name into a `numeric(10,3)` number and a title
 * remainder (docs/09 "Two mappings that need care").
 *
 * The rule is strict on purpose: anything the regexes do not recognise returns
 * `number: null` and lands in the review CSV. Guessing silently reorders a reader's chapter
 * list, which is the one bug the audience will not forgive.
 */

export interface ParsedChapterName {
  /** A `numeric(10,3)`-compatible decimal string ("12.5", "154"), or null when unparseable. */
  number: string | null
  /** The remainder after the number, or null when there is none. */
  title: string | null
  /** From a `Vol.2` / `Volume 2` prefix, when present. */
  volume: number | null
}

/** numeric(10,3): seven integer digits, three decimals. */
const MAX_INTEGER_DIGITS = 7
const MAX_DECIMALS = 3

const VOLUME_RE = /^v(?:ol(?:ume)?)?\.?\s*(\d{1,4})\b\s*[-–—:|,]?\s*/i
const NUMBER_RE = /^(?:(?:chapters?|chaps?|ch|episodes?|eps?|no|number|#)\.?\s*)?(\d+(?:\.\d+)?)/i
/** After the number: whitespace, or a separator, before the title remainder. */
const SEPARATOR_RE = /^(?:\s*[-–—:|~]+\s*|\s+)(.+)$/s
/** "Chapter 1-2" and "Chapter 1 2" are ranges or split parts, never a number plus a title. */
const NUMERIC_REMAINDER_RE = /^\d+(?:\.\d+)?$/

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#039;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
  '&#8211;': '–',
  '&#8212;': '—',
  '&#8217;': '’',
}

/** Decode the handful of entities the theme's editor emits, then tidy whitespace. */
export const decodeEntities = (value: string): string =>
  value.replace(
    /&(?:amp|lt|gt|quot|nbsp|#0?39|#8211|#8212|#8217);/gi,
    (m) => ENTITIES[m.toLowerCase()] ?? m,
  )

const cleanTitle = (value: string): string | null => {
  const out = decodeEntities(value)
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:|~]+/, '')
    .replace(/[\s\-–—:|~]+$/, '')
    .trim()
  return out === '' ? null : out
}

/** Normalise "007" → "7", "12.500" → "12.5", rejecting anything numeric(10,3) cannot hold. */
const normaliseNumber = (raw: string): string | null => {
  const [intPart = '', decPart = ''] = raw.split('.')
  if (decPart.length > MAX_DECIMALS) return null
  const int = intPart.replace(/^0+(?=\d)/, '')
  if (int.length > MAX_INTEGER_DIGITS) return null
  const dec = decPart.replace(/0+$/, '')
  return dec === '' ? int : `${int}.${dec}`
}

/**
 * Parse a legacy chapter display name.
 *
 * Handles "Chapter 12.5", "Ch.7 - The End", "Vol.2 Ch.3", "154", "Chapter 301: Title" and
 * returns `number: null` for anything else ("Prologue", "Chapter 1-2", "Special Extra").
 */
export const parseChapterNumber = (name: string): ParsedChapterName => {
  const empty: ParsedChapterName = { number: null, title: null, volume: null }
  if (typeof name !== 'string') return empty
  let rest = decodeEntities(name).replace(/\s+/g, ' ').trim()
  if (rest === '') return empty

  let volume: number | null = null
  const vol = VOLUME_RE.exec(rest)
  if (vol?.[1]) {
    volume = Number.parseInt(vol[1], 10)
    rest = rest.slice(vol[0].length)
  }

  const num = NUMBER_RE.exec(rest)
  if (!num?.[1]) return { number: null, title: cleanTitle(rest) ?? cleanTitle(name), volume }
  const number = normaliseNumber(num[1])
  if (number === null) return { number: null, title: cleanTitle(name), volume }

  const after = rest.slice(num[0].length)
  if (after.trim() === '') return { number, title: null, volume }

  const sep = SEPARATOR_RE.exec(after)
  // No separator ("Chapter 5v2") or a bare number after one ("Chapter 1-2"): do not guess.
  if (!sep?.[1] || NUMERIC_REMAINDER_RE.test(sep[1].trim()))
    return { number: null, title: cleanTitle(name), volume }
  return { number, title: cleanTitle(sep[1]), volume }
}

/** `true` when the row needs a human — i.e. it belongs in the review CSV. */
export const isUnparsedChapterName = (name: string): boolean =>
  parseChapterNumber(name).number === null
