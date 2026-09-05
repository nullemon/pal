import { messages } from './messages.js'

/**
 * Appearance → Copy (docs/15 "Copy the operator owns"): the handful of strings that carry
 * the site's voice, editable from the panel without a deploy.
 *
 * Everything else stays in `messages.ts`. The line is deliberate — "Save", "Next chapter"
 * and the 1,700 other strings are plumbing, and an operator who can edit them can only
 * break the site. What is here is the copy an owner actually asks to change: the hero
 * eyebrow, the empty states a new reader hits first, the Premium pitch, the emails.
 *
 * ## The two rules that make this safe
 *
 * 1. **An unset string is the catalogue.** `resolveCopy(null)` is `DEFAULT_COPY`, and
 *    `DEFAULT_COPY` is built out of `messages` rather than re-typed, so a site with nothing
 *    configured renders byte-for-byte what it rendered before this file existed. Clearing a
 *    field in the panel is therefore the same thing as "reset to default".
 * 2. **A stored override can never break a page.** `resolveCopy` takes arbitrary jsonb and
 *    is total: not a string, empty, longer than the field allows, or carrying a `{token}`
 *    the call site does not substitute — every one of those falls back to the default rather
 *    than reaching a reader. Control characters are stripped rather than rejected, because
 *    a pasted newline in an email subject is a header-injection attempt in every mail
 *    transport ever written and is never what the operator meant.
 *
 * The admin route uses the same `copyProblem` to refuse a bad save with a message naming
 * what is wrong, so the render-time fallback is a backstop for rows written before a
 * registry change, not the normal path.
 *
 * Dependency-free apart from `messages.js`, and exported from `@palscans/core/copy` rather
 * than the package root: the root barrel reaches `watermark.ts`, which imports zod, and the
 * registry has no business in a reader's bundle either (docs/20 "What was in there").
 */

export const COPY_SETTING_KEY = 'copy'

export const COPY_GROUPS = ['home', 'empty', 'pages', 'ageGate', 'premium', 'email'] as const
export type CopyGroup = (typeof COPY_GROUPS)[number]

export interface CopyEntry {
  /** The catalogue path this overrides, and the key in `settings.copy`. */
  id: string
  group: CopyGroup
  /** The shipped string. Shown as placeholder text in the panel, and the fallback. */
  defaultText: string
  /** `{token}`s the call site substitutes. Anything else in an override is a mistake. */
  placeholders: readonly string[]
  /** Refused above this at save time; an oversized stored row falls back at render time. */
  max: number
  /** A textarea in the panel, and newlines survive. Single-line fields collapse them. */
  multiline?: true
  /**
   * `false` when the catalogue carries the string but no page renders it yet. docs/15 names
   * the maintenance page and the age gate; neither is built, and the panel says so rather
   * than pretending an edit will show up somewhere.
   */
  rendered: boolean
}

const entry = (
  id: string,
  group: CopyGroup,
  defaultText: string,
  opts: {
    placeholders?: readonly string[]
    max?: number
    multiline?: true
    rendered?: boolean
  } = {},
): CopyEntry => ({
  id,
  group,
  defaultText,
  placeholders: opts.placeholders ?? [],
  max: opts.max ?? 200,
  ...(opts.multiline ? { multiline: opts.multiline } : {}),
  rendered: opts.rendered !== false,
})

/**
 * The registry. Each `defaultText` is read from `messages` rather than copied, so the two
 * can never drift: changing the catalogue changes the default and the panel's placeholder.
 */
export const COPY_ENTRIES: readonly CopyEntry[] = [
  // ——— Home ———
  // docs/15 says "the home hero eyebrow". The catalogue has two candidates and only one of
  // them is rendered: `messages.layouts.featured` is the word above the hero in Home B, C,
  // E and F. `messages.home.heroEyebrow` holds the same word and has no call site at all —
  // it is dead copy, and wiring the panel to it would have shipped a field that does nothing.
  entry('layouts.featured', 'home', messages.layouts.featured, { max: 40 }),
  entry('home.emptyUpdates', 'home', messages.home.emptyUpdates),

  // ——— Empty states ———
  entry('account.emptyBookmarks', 'empty', messages.account.emptyBookmarks),
  entry('me.bookmarks.emptyStatus', 'empty', messages.me.bookmarks.emptyStatus, {
    placeholders: ['status'],
  }),
  entry('account.emptyHistory', 'empty', messages.account.emptyHistory),
  entry('browse.empty', 'empty', messages.browse.empty),
  entry('search.empty', 'empty', messages.search.empty, { placeholders: ['q'] }),
  entry('comments.empty', 'empty', messages.comments.empty),

  // ——— Standalone pages ———
  entry('notFoundPage.hint', 'pages', messages.notFoundPage.hint, { max: 300 }),
  entry('authPage.signInLead', 'pages', messages.authPage.signInLead),
  entry('authPage.registerLead', 'pages', messages.authPage.registerLead),
  entry('common.maintenance', 'pages', messages.common.maintenance, {
    placeholders: ['eta'],
    rendered: false,
  }),

  // ——— Age gate ———
  entry('common.ageGateTitle', 'ageGate', messages.common.ageGateTitle, { rendered: false }),
  entry('common.ageGateBody', 'ageGate', messages.common.ageGateBody, {
    max: 300,
    rendered: false,
  }),
  entry('common.ageGateConfirm', 'ageGate', messages.common.ageGateConfirm, {
    max: 60,
    rendered: false,
  }),
  entry('common.ageGateLeave', 'ageGate', messages.common.ageGateLeave, {
    max: 60,
    rendered: false,
  }),

  // ——— Premium ———
  entry('premium.pitch', 'premium', messages.premium.pitch),
  entry('premium.bullets.adFree', 'premium', messages.premium.bullets.adFree, { max: 80 }),
  entry('premium.bullets.earlyAccess', 'premium', messages.premium.bullets.earlyAccess, {
    max: 80,
  }),
  entry('premium.bullets.offline', 'premium', messages.premium.bullets.offline, { max: 80 }),
  entry('premium.adBlockNote', 'premium', messages.premium.adBlockNote, { max: 240 }),

  // ——— Email ———
  entry('email.verify.subject', 'email', messages.email.verify.subject, { max: 120 }),
  entry('email.verify.intro', 'email', messages.email.verify.intro, { max: 600, multiline: true }),
  entry('email.reset.subject', 'email', messages.email.reset.subject, { max: 120 }),
  entry('email.reset.intro', 'email', messages.email.reset.intro, { max: 600, multiline: true }),
  entry('email.passwordChanged.subject', 'email', messages.email.passwordChanged.subject, {
    max: 120,
  }),
  entry('email.passwordChanged.intro', 'email', messages.email.passwordChanged.intro, {
    max: 600,
    multiline: true,
  }),
  entry('email.deletion.subject', 'email', messages.email.deletion.subject, { max: 120 }),
  entry('email.deletion.intro', 'email', messages.email.deletion.intro, { max: 400 }),
] as const

export type CopyKey = (typeof COPY_ENTRIES)[number]['id']
export type CopyOverrides = Readonly<Record<string, string>>
export type CopyMap = Readonly<Record<string, string>>

const BY_ID: ReadonlyMap<string, CopyEntry> = new Map(COPY_ENTRIES.map((e) => [e.id, e]))

export const copyEntry = (id: string): CopyEntry | undefined => BY_ID.get(id)

export const COPY_KEYS: readonly string[] = COPY_ENTRIES.map((e) => e.id)

/** Every shipped string, keyed by id. This is what an unconfigured site renders. */
export const DEFAULT_COPY: CopyMap = Object.freeze(
  Object.fromEntries(COPY_ENTRIES.map((e) => [e.id, e.defaultText])),
)

/**
 * Everything below U+0020 except the two line breaks, plus DEL. A newline pasted into an
 * email subject is `Subject: …\r\nBcc: …` in every SMTP implementation; `lib/config/smtp.ts`
 * already refuses one, and stripping the character here means the operator's text is never
 * silently mangled further down the pipe instead.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const CONTROL = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g
const TOKEN = /\{([a-zA-Z_]+)\}/g

/**
 * What is wrong with a candidate override, or `null` if it is usable.
 *
 * `empty` is not an error in the panel — an empty field *is* "use the default" — but the
 * caller needs to tell the two apart, so it is reported rather than swallowed.
 */
export type CopyProblem = 'unknown' | 'not_text' | 'empty' | 'too_long' | 'unknown_placeholder'

export interface CopyIssue {
  problem: CopyProblem
  /** The offending `{token}`, for `unknown_placeholder`. */
  token?: string
  /** The length that was too long, and the cap, for `too_long`. */
  length?: number
  max?: number
}

/**
 * Normalise a candidate the way both the save route and the renderer see it: control
 * characters gone, newlines collapsed unless the field is multiline, ends trimmed.
 */
export const normalizeCopyText = (entry: CopyEntry, raw: string): string => {
  const stripped = raw.replace(CONTROL, '')
  const flattened = entry.multiline
    ? stripped.replace(/\r\n?/g, '\n')
    : stripped.replace(/[\r\n]+/g, ' ')
  return flattened.trim()
}

/** Tokens an override uses that its call site will never substitute. */
export const unknownPlaceholders = (entry: CopyEntry, text: string): string[] => {
  const out: string[] = []
  for (const m of text.matchAll(TOKEN)) {
    const name = m[1]
    if (name && !entry.placeholders.includes(name) && !out.includes(name)) out.push(name)
  }
  return out
}

export const copyProblem = (id: string, raw: unknown): CopyIssue | null => {
  const entry = BY_ID.get(id)
  if (!entry) return { problem: 'unknown' }
  if (typeof raw !== 'string') return { problem: 'not_text' }
  const text = normalizeCopyText(entry, raw)
  if (text === '') return { problem: 'empty' }
  if (text.length > entry.max) return { problem: 'too_long', length: text.length, max: entry.max }
  const bad = unknownPlaceholders(entry, text)[0]
  if (bad !== undefined) return { problem: 'unknown_placeholder', token: bad }
  return null
}

/**
 * The overrides worth storing: normalised, usable, and different from the shipped string.
 * Anything else is dropped, so `settings.copy` never accumulates rows that do nothing and
 * the client payload for a site with nothing configured is `{}`.
 */
export const normalizeCopyOverrides = (raw: unknown): CopyOverrides => {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const entry of COPY_ENTRIES) {
    const value = o[entry.id]
    if (typeof value !== 'string') continue
    if (copyProblem(entry.id, value)) continue
    const text = normalizeCopyText(entry, value)
    if (text !== entry.defaultText) out[entry.id] = text
  }
  return out
}

/**
 * The strings to render. Total by construction: whatever the row holds, every key of
 * `DEFAULT_COPY` comes back with a usable value.
 */
export const resolveCopy = (raw: unknown): CopyMap => {
  const overrides = normalizeCopyOverrides(raw)
  const keys = Object.keys(overrides)
  if (keys.length === 0) return DEFAULT_COPY
  return Object.freeze({ ...DEFAULT_COPY, ...overrides })
}

/** One string, without building the whole map — for call sites that need a single entry. */
export const copyText = (map: CopyMap, id: string): string => map[id] ?? DEFAULT_COPY[id] ?? ''

/**
 * `copy('browse.empty')` — the shape server components read, because a bare `map[id]` is
 * `string | undefined` under `noUncheckedIndexedAccess` and would put a cast at every one of
 * forty call sites. The lookup is still total: an id outside the registry answers `''`
 * rather than throwing, so a stale call site degrades to empty text, never to a 500.
 */
export type CopyFn = (id: string) => string

export const copyFn =
  (map: CopyMap): CopyFn =>
  (id) =>
    copyText(map, id)
