/**
 * Bulk chapter drop: turning a folder tree or a ZIP/CBZ into a *proposal* an operator can
 * read and correct before anything is committed (docs/03 "Upload flow", docs/04 "warnings
 * surface inline before upload").
 *
 * Nothing here touches the DOM, the filesystem or the network — the browser unzips
 * (docs/03: `fflate` in the browser, so a 400 MB archive never reaches the server) and then
 * hands the entry list to `planDrop`, which answers with chapters, page order, and every
 * reason it is unsure. A bulk import that guesses silently and gets chapter 10 before
 * chapter 9 is worse than uploading by hand, so every guess carries its provenance
 * (`numberSource`) and its rejected alternatives.
 *
 * The number itself is normalised by `parseChapterNumber` (./chapter-number.ts) — the same
 * strict `numeric(10,3)` rules the legacy importer uses. This file only finds the candidate
 * inside a release name ("[Group] Series - 012", "ch_012") and hands it over.
 */

import { parseChapterNumber } from './chapter-number.js'

// ---------------------------------------------------------------------------------------
// file names
// ---------------------------------------------------------------------------------------

const IMAGE_RE = /\.(jpe?g|png|webp|avif|gif)$/i

export const isImageName = (name: string): boolean => IMAGE_RE.test(name)

/** The five types the upload intent accepts (apps/web/components/admin/schemas.ts). */
export const mimeForName = (name: string): string | null => {
  const ext = name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'avif':
      return 'image/avif'
    case 'gif':
      return 'image/gif'
    default:
      return null
  }
}

const isDigit = (c: string): boolean => c >= '0' && c <= '9'

/**
 * Natural order: `1.jpg` < `2.jpg` < `10.jpg`, and `007` sorts with `7` rather than after
 * `10`. Deliberately not `localeCompare(…, { numeric: true })` — that reads the runtime's
 * collation, and page order must not depend on which browser the operator uses.
 */
export const naturalCompare = (a: string, b: string): number => {
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const ac = a[i] as string
    const bc = b[j] as string
    const ad = isDigit(ac)
    const bd = isDigit(bc)
    if (ad && bd) {
      let ia = i
      while (ia < a.length && isDigit(a[ia] as string)) ia++
      let jb = j
      while (jb < b.length && isDigit(b[jb] as string)) jb++
      const an = a.slice(i, ia).replace(/^0+(?=\d)/, '')
      const bn = b.slice(j, jb).replace(/^0+(?=\d)/, '')
      if (an.length !== bn.length) return an.length - bn.length
      if (an !== bn) return an < bn ? -1 : 1
      // Same value: the less-padded spelling first, so `1` and `01` order stably.
      if (ia - i !== jb - j) return ia - i - (jb - j)
      i = ia
      j = jb
      continue
    }
    if (ad !== bd) return ad ? -1 : 1 // digits before letters: `1.jpg` before `cover.jpg`
    const al = ac.toLowerCase()
    const bl = bc.toLowerCase()
    if (al !== bl) return al < bl ? -1 : 1
    i++
    j++
  }
  if (a.length - i !== b.length - j) return a.length - i - (b.length - j)
  return a === b ? 0 : a < b ? -1 : 1
}

// ---------------------------------------------------------------------------------------
// entry paths
// ---------------------------------------------------------------------------------------

export type RejectReason =
  | 'empty'
  | 'too_long'
  | 'control_chars'
  | 'absolute'
  | 'traversal'
  | 'too_deep'
  | 'metadata'
  | 'hidden'
  | 'directory'
  | 'not_image'
  | 'entry_too_large'
  | 'suspicious_ratio'
  | 'entry_limit'
  | 'size_limit'

/** Rejections an operator does not need to be told about: junk every archive carries. */
export const QUIET_REJECTIONS: ReadonlySet<RejectReason> = new Set<RejectReason>([
  'metadata',
  'hidden',
  'directory',
])

export const MAX_ENTRY_PATH = 300
export const MAX_PATH_DEPTH = 12

export type PathCheck = { ok: true; path: string } | { ok: false; reason: RejectReason }

// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point
const CONTROL_RE = /[\u0000-\u001f\u007f]/
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:/
const METADATA_NAMES = new Set(['thumbs.db', 'desktop.ini', '.ds_store'])

/**
 * A ZIP entry name is attacker-controlled text, not a path (`../../etc/passwd`,
 * `/etc/passwd`, `C:\Windows\…`, an embedded NUL). This is the only place a name becomes a
 * path: everything it returns is relative, has no `.`/`..` segment, and is bounded in
 * length and depth. Anything else is refused with a reason the preview can show.
 */
export const sanitizeEntryPath = (raw: string): PathCheck => {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty' }
  if (raw.trim() === '') return { ok: false, reason: 'empty' }
  if (raw.length > MAX_ENTRY_PATH) return { ok: false, reason: 'too_long' }
  if (CONTROL_RE.test(raw)) return { ok: false, reason: 'control_chars' }
  const unified = raw.replace(/\\/g, '/')
  if (unified.startsWith('/') || WINDOWS_DRIVE_RE.test(unified) || unified.startsWith('~/'))
    return { ok: false, reason: 'absolute' }
  const isDir = unified.endsWith('/')
  const segments: string[] = []
  for (const segment of unified.split('/')) {
    if (segment === '' || segment === '.') continue
    // `..` anywhere, not just at the front: `a/../../b` escapes just as well.
    if (segment === '..') return { ok: false, reason: 'traversal' }
    if (segment === '__MACOSX') return { ok: false, reason: 'metadata' }
    segments.push(segment)
  }
  if (segments.length === 0) return { ok: false, reason: 'empty' }
  if (segments.length > MAX_PATH_DEPTH) return { ok: false, reason: 'too_deep' }
  if (isDir) return { ok: false, reason: 'directory' }
  const name = segments[segments.length - 1] as string
  if (name.startsWith('.')) return { ok: false, reason: 'hidden' }
  if (METADATA_NAMES.has(name.toLowerCase())) return { ok: false, reason: 'metadata' }
  return { ok: true, path: segments.join('/') }
}

// ---------------------------------------------------------------------------------------
// archive guards (the ZIP bomb)
// ---------------------------------------------------------------------------------------

export interface ZipLimits {
  /** Entries examined, including the ones skipped — a bomb can be a million tiny files. */
  maxEntries: number
  /** Uncompressed bytes taken from one archive. */
  maxTotalBytes: number
  /** Uncompressed bytes of a single entry (mirrors MAX_FILE_BYTES on the upload intent). */
  maxEntryBytes: number
  /** Uncompressed ÷ compressed. A real JPEG/PNG is ≈ 1; 100× is not a page scan. */
  maxRatio: number
  /** Below this an entry's ratio is not interesting (a 4 KB blank PNG compresses well). */
  ratioFloorBytes: number
}

export const ZIP_LIMITS: ZipLimits = {
  maxEntries: 3000,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxEntryBytes: 50 * 1024 * 1024,
  maxRatio: 100,
  ratioFloorBytes: 1024 * 1024,
}

/** What a ZIP central directory says about one entry, before anything is decompressed. */
export interface ZipEntryInfo {
  name: string
  /** Compressed size. */
  size: number
  /** Uncompressed size, as claimed by the archive. */
  originalSize: number
}

export interface GuardDecision {
  take: boolean
  path?: string
  reason?: RejectReason
}

export interface ZipGuard {
  /** Called once per entry, before it is decompressed. */
  check(info: ZipEntryInfo): GuardDecision
  readonly rejected: ReadonlyArray<{ path: string; reason: RejectReason }>
  /** Set when a whole-archive cap tripped; everything after it is refused. */
  readonly aborted: 'entry_limit' | 'size_limit' | null
  readonly entries: number
  readonly bytes: number
}

/**
 * The decompression guard (docs/03 unzips in the browser, so this is where a hostile
 * archive is stopped). Every decision is made from the central directory — entry count,
 * claimed uncompressed size, and compression ratio — so a bomb is refused *before* it is
 * inflated, and the archive as a whole is capped even if every single entry looks sane.
 */
export const createZipGuard = (limits: ZipLimits = ZIP_LIMITS): ZipGuard => {
  const rejected: Array<{ path: string; reason: RejectReason }> = []
  let aborted: 'entry_limit' | 'size_limit' | null = null
  let entries = 0
  let bytes = 0
  const refuse = (path: string, reason: RejectReason): GuardDecision => {
    if (!QUIET_REJECTIONS.has(reason) && rejected.length < 200) rejected.push({ path, reason })
    return { take: false, reason }
  }
  return {
    check(info: ZipEntryInfo): GuardDecision {
      if (aborted) return { take: false, reason: aborted }
      entries += 1
      if (entries > limits.maxEntries) {
        aborted = 'entry_limit'
        return refuse(info.name, 'entry_limit')
      }
      const safe = sanitizeEntryPath(info.name)
      if (!safe.ok) return refuse(info.name, safe.reason)
      if (!isImageName(safe.path)) return refuse(safe.path, 'not_image')
      const original = Number.isFinite(info.originalSize) ? Math.max(0, info.originalSize) : 0
      if (original > limits.maxEntryBytes) return refuse(safe.path, 'entry_too_large')
      const compressed = Number.isFinite(info.size) ? Math.max(0, info.size) : 0
      const ratio =
        compressed > 0 ? original / compressed : original > 0 ? Number.POSITIVE_INFINITY : 1
      if (original > limits.ratioFloorBytes && ratio > limits.maxRatio)
        return refuse(safe.path, 'suspicious_ratio')
      if (bytes + original > limits.maxTotalBytes) {
        aborted = 'size_limit'
        return refuse(safe.path, 'size_limit')
      }
      bytes += original
      return { take: true, path: safe.path }
    },
    get rejected() {
      return rejected
    },
    get aborted() {
      return aborted
    },
    get entries() {
      return entries
    },
    get bytes() {
      return bytes
    },
  }
}

// ---------------------------------------------------------------------------------------
// chapter numbers inside release names
// ---------------------------------------------------------------------------------------

/** Where the number came from — the preview says this out loud. */
export type NumberSource = 'marker' | 'single' | 'trailing' | 'none'

export interface DetectedNumber {
  /** `numeric(10,3)`-compatible decimal string, or null when nothing usable was found. */
  number: string | null
  title: string | null
  volume: number | null
  source: NumberSource
  /** Every numeric candidate seen, chosen one first. More than one means "check me". */
  candidates: string[]
}

const ARCHIVE_EXT_RE = /\.(cbz|zip|cbr|rar|7z)$/i
const LEADING_TAG_RE = /^[\s._-]*[[({][^\])}]*[\])}][\s._-]*/
const TRAILING_TAG_RE = /[\s._-]*[[({][^\])}]*[\])}][\s._-]*$/
const VOLUME_ANY_RE = /(?:^|[^a-z0-9])v(?:ol(?:ume)?)?\.?\s*(\d{1,4})(?![\d])/i
/** `Chapter 12.5`, `ch_012`, `ch.12`, `c012`, `episode 7`, `cap 3`. */
const MARKER_RE =
  /(?:^|[^a-z0-9])(?:chapters?|chaps?|chp|ch|cap(?:itulo)?|episodes?|eps?|ep|c)[\s._#-]*(\d{1,7}(?:\.\d{1,3})?)(?![\d])/gi
const NUMBER_TOKEN_RE = /(?:^|[^a-z0-9.])(\d{1,7}(?:\.\d{1,3})?)(?![\d])/gi
/** Tokens that are never a chapter: `v2`, `1080p`, `x264`, `8bit`, `2nd`, `720x1280`. */
const NOT_A_CHAPTER_RE = /^(?:p|px|bit|k|nd|st|rd|th|x\d)/i

const stripTags = (value: string): string => {
  let out = value
  let previous: string
  do {
    previous = out
    out = out.replace(LEADING_TAG_RE, '').replace(TRAILING_TAG_RE, '')
  } while (out !== previous && out !== '')
  return out
}

/**
 * Find the chapter number in a folder or archive name and normalise it through
 * `parseChapterNumber`.
 *
 * Order of preference: an explicit marker (`Chapter 12.5`, `ch_012`, `c012`) beats a bare
 * trailing number (`[Group] Series - 012`), and when several numbers survive, the last one
 * wins and the rest are returned as `candidates` so the preview can say "more than one
 * number here". Nothing recognisable returns `number: null` — the operator types it, which
 * is the only honest outcome.
 */
export const detectChapterNumber = (raw: string): DetectedNumber => {
  const empty: DetectedNumber = {
    number: null,
    title: null,
    volume: null,
    source: 'none',
    candidates: [],
  }
  if (typeof raw !== 'string' || raw.trim() === '') return empty
  const withoutExt = raw.replace(ARCHIVE_EXT_RE, '')
  const untagged = stripTags(withoutExt) || withoutExt
  // `_` and `+` are word separators in release names; a `.` between digits is a decimal.
  const name = untagged
    .replace(/[_+]+/g, ' ')
    .replace(/(?<=\D)\.(?=\D)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (name === '') return empty

  const volumeMatch = VOLUME_ANY_RE.exec(name)
  const volumeText = volumeMatch?.[1]
  const volumeSpan = volumeMatch
    ? { start: volumeMatch.index, end: volumeMatch.index + volumeMatch[0].length }
    : null

  const markers = [...name.matchAll(MARKER_RE)]
    .filter(
      (m) => !volumeSpan || m.index >= volumeSpan.end || m.index + m[0].length <= volumeSpan.start,
    )
    .map((m) => ({ value: m[1] as string, end: m.index + m[0].length }))

  let chosen: { value: string; end: number } | null = null
  let source: NumberSource = 'none'
  let candidates: string[] = []
  if (markers.length > 0) {
    chosen = markers[markers.length - 1] as { value: string; end: number }
    source = 'marker'
    candidates = markers.map((m) => m.value)
  } else {
    const tokens = [...name.matchAll(NUMBER_TOKEN_RE)]
      .filter(
        (m) =>
          !volumeSpan || m.index >= volumeSpan.end || m.index + m[0].length <= volumeSpan.start,
      )
      .filter((m) => !NOT_A_CHAPTER_RE.test(name.slice(m.index + m[0].length)))
      .map((m) => ({ value: m[1] as string, end: m.index + m[0].length }))
    if (tokens.length > 0) {
      chosen = tokens[tokens.length - 1] as { value: string; end: number }
      source = tokens.length === 1 ? 'single' : 'trailing'
      candidates = tokens.map((t) => t.value)
    }
  }
  if (!chosen) return { ...empty, volume: volumeText ? Number.parseInt(volumeText, 10) : null }

  // Hand the candidate to the strict parser, which owns numeric(10,3) normalisation
  // ("007" → "7", "12.500" → "12.5") and the "Chapter 1-2 is a range, not a title" rule.
  const remainder = name.slice(chosen.end)
  const canonical = `${volumeText ? `Vol.${volumeText} ` : ''}Chapter ${chosen.value}${remainder}`
  const parsed = parseChapterNumber(canonical)
  const ordered = [chosen.value, ...candidates.filter((c) => c !== chosen.value)]
  if (parsed.number === null)
    return {
      number: null,
      title: null,
      volume: volumeText ? Number.parseInt(volumeText, 10) : null,
      source: 'none',
      candidates: ordered,
    }
  return {
    number: parsed.number,
    title: parsed.title,
    volume: parsed.volume ?? (volumeText ? Number.parseInt(volumeText, 10) : null),
    source,
    candidates: ordered,
  }
}

// ---------------------------------------------------------------------------------------
// page ordering
// ---------------------------------------------------------------------------------------

export type PageRole = 'cover' | 'page' | 'extra'

export interface PageClass {
  role: PageRole
  /** The trailing numeric run of the file name — what page ordering uses. */
  num: number | null
}

const COVER_RE = /(?:^|[^a-z])(cover|front|frontispiece|folder)(?:$|[^a-z])/i
const EXTRA_RE =
  /(?:^|[^a-z])(credits?|thanks|thankyou|staff|joinus|join|discord|raws?|logo|banner|omake|afterword|announcement|notes?|end|theend|back)(?:$|[^a-z])/i

/**
 * What a file inside a chapter folder is. A stray `cover.jpg` or `credits.png` must not
 * silently become page 1 or push the real pages around — it is kept, labelled, and parked
 * at the front (covers) or the back (everything else) where the operator can see it.
 */
export const classifyPageName = (name: string): PageClass => {
  const base = (name.split('/').pop() ?? name).replace(/\.[^.]+$/, '')
  const words = base.replace(/[_+-]+/g, ' ')
  const runs = base.match(/\d+/g)
  const last = runs?.[runs.length - 1]
  const num = last === undefined ? null : Number.parseInt(last, 10)
  if (COVER_RE.test(words)) return { role: 'cover', num }
  if (EXTRA_RE.test(words)) return { role: 'extra', num }
  // No digits at all and no keyword: not a numbered page, so it does not get to claim one.
  if (num === null) return { role: 'extra', num: null }
  return { role: 'page', num }
}

const ROLE_RANK: Record<PageRole, number> = { cover: 0, page: 1, extra: 2 }

export interface PlannedPage {
  path: string
  name: string
  bytes: number
  role: PageRole
  num: number | null
}

/** Covers first, then pages by their number, then everything unnumbered — ties natural. */
export const comparePages = (a: PlannedPage, b: PlannedPage): number => {
  if (ROLE_RANK[a.role] !== ROLE_RANK[b.role]) return ROLE_RANK[a.role] - ROLE_RANK[b.role]
  if (a.role === 'page' && a.num !== null && b.num !== null && a.num !== b.num) return a.num - b.num
  return naturalCompare(a.path, b.path)
}

// ---------------------------------------------------------------------------------------
// the plan
// ---------------------------------------------------------------------------------------

export type ChapterIssue =
  | { kind: 'no_number' }
  | { kind: 'ambiguous_number'; candidates: string[] }
  | { kind: 'duplicate_number'; number: string }
  | { kind: 'missing_pages'; numbers: number[] }
  | { kind: 'repeated_page_number'; numbers: number[] }
  | { kind: 'extra_files'; count: number }
  | { kind: 'too_many_pages'; max: number }
  | { kind: 'no_pages' }

export interface PlannedChapter {
  /** Stable within one plan: the group path that produced it. */
  id: string
  /** The folder (or archive stem) the pages came from — shown as "found in". */
  group: string
  number: string | null
  title: string | null
  volume: number | null
  numberSource: NumberSource
  candidates: string[]
  pages: PlannedPage[]
  issues: ChapterIssue[]
}

export interface DropPlan {
  chapters: PlannedChapter[]
  rejected: Array<{ path: string; reason: RejectReason }>
  /** Junk the preview does not itemise (`.DS_Store`, `__MACOSX`, directory entries). */
  quiet: number
  totalPages: number
  totalBytes: number
}

export interface DropEntry {
  /** Relative path, archive stem included: `Series Ch 12/001.jpg`. */
  path: string
  bytes?: number
}

export interface PlanOptions {
  /** Mirrors MAX_PAGES_PER_CHAPTER on the upload intent. */
  maxPages?: number
}

const dirOf = (path: string): string => {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

const leafOf = (dir: string): string => (dir === '' ? '' : nameOf(dir))

/**
 * A flat folder whose *file names* carry the chapter (`ch01_001.jpg`, `ch02_001.jpg`).
 * Only split when every file has a marker followed by a second number (the page), and at
 * least two chapters come out — otherwise a chapter whose pages are named `c01.jpg`,
 * `c02.jpg` would be shredded into one-page chapters.
 */
const splitByFileMarkers = (files: PlannedPage[]): Map<string, PlannedPage[]> | null => {
  const buckets = new Map<string, PlannedPage[]>()
  for (const file of files) {
    const base = nameOf(file.path).replace(/\.[^.]+$/, '')
    MARKER_RE.lastIndex = 0
    const matches = [...base.replace(/[_+]+/g, ' ').matchAll(MARKER_RE)]
    const match = matches[0]
    if (!match?.[1]) return null
    const after = base.replace(/[_+]+/g, ' ').slice(match.index + match[0].length)
    if (!/\d/.test(after)) return null // no page number after the chapter marker
    const key = match[1]
    const list = buckets.get(key) ?? []
    list.push(file)
    buckets.set(key, list)
  }
  return buckets.size >= 2 ? buckets : null
}

const pageIssues = (pages: PlannedPage[], maxPages: number): ChapterIssue[] => {
  const issues: ChapterIssue[] = []
  if (pages.length === 0) return [{ kind: 'no_pages' }]
  if (pages.length > maxPages) issues.push({ kind: 'too_many_pages', max: maxPages })
  const numbered = pages.filter((p) => p.role === 'page' && p.num !== null)
  const seen = new Map<number, number>()
  for (const page of numbered) seen.set(page.num as number, (seen.get(page.num as number) ?? 0) + 1)
  const repeated = [...seen.entries()].filter(([, n]) => n > 1).map(([num]) => num)
  if (repeated.length > 0)
    issues.push({ kind: 'repeated_page_number', numbers: repeated.slice(0, 5) })
  if (numbered.length > 1) {
    const nums = [...seen.keys()].sort((a, b) => a - b)
    const first = nums[0] as number
    const last = nums[nums.length - 1] as number
    const missing: number[] = []
    for (let n = first; n <= last && missing.length < 6; n++) if (!seen.has(n)) missing.push(n)
    if (missing.length > 0) issues.push({ kind: 'missing_pages', numbers: missing.slice(0, 5) })
  }
  const extras = pages.filter((p) => p.role !== 'page').length
  if (extras > 0) issues.push({ kind: 'extra_files', count: extras })
  return issues
}

/**
 * Read a dropped folder tree / unzipped archive into a chapter proposal.
 *
 * Boundaries: one chapter per directory that directly contains images. A directory with no
 * detectable number whose parent *is* a chapter is folded into that parent as extras
 * (`Ch 12/extras/credits.png`), and a flat directory whose file names carry chapter markers
 * is split by them. Everything else is left as its own chapter for the operator to judge.
 */
export const planDrop = (entries: DropEntry[], options: PlanOptions = {}): DropPlan => {
  const maxPages = options.maxPages ?? 400
  const rejected: Array<{ path: string; reason: RejectReason }> = []
  let quiet = 0
  const groups = new Map<string, PlannedPage[]>()
  for (const entry of entries) {
    const safe = sanitizeEntryPath(entry.path)
    if (!safe.ok) {
      if (QUIET_REJECTIONS.has(safe.reason)) quiet += 1
      else rejected.push({ path: entry.path, reason: safe.reason })
      continue
    }
    if (!isImageName(safe.path)) {
      rejected.push({ path: safe.path, reason: 'not_image' })
      continue
    }
    const name = nameOf(safe.path)
    const { role, num } = classifyPageName(name)
    const page: PlannedPage = {
      path: safe.path,
      name,
      bytes: Math.max(0, Math.trunc(entry.bytes ?? 0)),
      role,
      num,
    }
    const dir = dirOf(safe.path)
    const list = groups.get(dir) ?? []
    list.push(page)
    groups.set(dir, list)
  }

  // Split flat groups whose file names carry the chapter number.
  for (const [dir, files] of [...groups]) {
    const split = splitByFileMarkers(files)
    if (!split) continue
    groups.delete(dir)
    for (const [marker, chapterFiles] of split)
      groups.set(dir === '' ? `ch${marker}` : `${dir}/ch${marker}`, chapterFiles)
  }

  const detected = new Map<string, DetectedNumber>()
  for (const dir of groups.keys()) detected.set(dir, detectChapterNumber(leafOf(dir) || dir))

  // A numberless folder inside a numbered one is that chapter's extras, not a chapter.
  for (const [dir, files] of [...groups]) {
    if (dir === '') continue
    const own = detected.get(dir)
    if (own?.number) continue
    const parent = dirOf(dir)
    if (!groups.has(parent) || !detected.get(parent)?.number) continue
    const target = groups.get(parent) as PlannedPage[]
    for (const file of files)
      target.push({ ...file, role: file.role === 'cover' ? 'cover' : 'extra' })
    groups.delete(dir)
    detected.delete(dir)
  }

  const chapters: PlannedChapter[] = []
  for (const [dir, files] of groups) {
    const info = detected.get(dir) ?? detectChapterNumber(leafOf(dir) || dir)
    const pages = [...files].sort(comparePages)
    const issues: ChapterIssue[] = []
    if (info.number === null) issues.push({ kind: 'no_number' })
    else if (info.candidates.length > 1)
      issues.push({ kind: 'ambiguous_number', candidates: info.candidates.slice(0, 4) })
    issues.push(...pageIssues(pages, maxPages))
    chapters.push({
      id: dir,
      group: dir,
      number: info.number,
      title: info.title,
      volume: info.volume,
      numberSource: info.source,
      candidates: info.candidates,
      pages,
      issues,
    })
  }

  // Two folders that parsed to the same number: one of them is wrong, and neither may be
  // uploaded blind — the intent would otherwise write both into the same chapter row.
  const byNumber = new Map<string, number>()
  for (const chapter of chapters)
    if (chapter.number) byNumber.set(chapter.number, (byNumber.get(chapter.number) ?? 0) + 1)
  for (const chapter of chapters)
    if (chapter.number && (byNumber.get(chapter.number) ?? 0) > 1)
      chapter.issues.unshift({ kind: 'duplicate_number', number: chapter.number })

  chapters.sort((a, b) => {
    const an = a.number === null ? Number.POSITIVE_INFINITY : Number.parseFloat(a.number)
    const bn = b.number === null ? Number.POSITIVE_INFINITY : Number.parseFloat(b.number)
    if (an !== bn) return an - bn
    return naturalCompare(a.group, b.group)
  })

  return {
    chapters,
    rejected,
    quiet,
    totalPages: chapters.reduce((n, c) => n + c.pages.length, 0),
    totalBytes: chapters.reduce((n, c) => n + c.pages.reduce((b, p) => b + p.bytes, 0), 0),
  }
}
