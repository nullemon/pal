import { type CommentBody, mentions, plainText } from './body.js'
import { allAllowlisted, type DetectedLink, detectLinks } from './links.js'

/**
 * Automod scoring (docs/14-comments.md §4). Each rule adds to a score; thresholds decide
 * publish / hold / shadow. Everything is logged with the comment so a moderator sees why.
 */
export type AutomodRule =
  | 'new_account_24h'
  | 'new_account_7d'
  | 'link_present'
  | 'repeated_text'
  | 'near_duplicate'
  | 'shouting'
  | 'char_spam'
  | 'emoji_spam'
  | 'mention_flood'
  | 'velocity'
  | 'reported_history'
  | 'reputation_credit'
  | 'premium_credit'

export type AutomodDecision = 'publish' | 'hold' | 'shadow'

export interface AutomodAuthor {
  createdAt: Date
  /** Number of the author's published comments. */
  publishedComments: number
  /** Actioned reports against the author in the last 30 days. */
  actionedReports30d: number
  isPremium: boolean
  isStaff: boolean
}

export interface AutomodInput {
  body: CommentBody | string
  author: AutomodAuthor
  /** Plain-text bodies of the author's recent comments (for repeat / near-duplicate). */
  recentBodies?: readonly string[]
  /** Timestamps of the author's comments in the last minute. */
  recentCommentTimes?: readonly Date[]
  /** Domain allowlist; allowlisted links do not count as "link present". */
  linkAllowlist?: Iterable<string>
  /** Whether the site holds comments containing links (default true). */
  holdLinks?: boolean
}

export interface AutomodThresholds {
  hold: number
  shadow: number
}
export const DEFAULT_THRESHOLDS: AutomodThresholds = { hold: 6, shadow: 10 }

export interface AutomodResult {
  score: number
  rules: AutomodRule[]
  decision: AutomodDecision
  hasLink: boolean
  links: DetectedLink[]
}

export const RULE_WEIGHTS: Record<AutomodRule, number> = {
  new_account_24h: 3,
  new_account_7d: 1,
  link_present: 5,
  repeated_text: 4,
  near_duplicate: 3,
  shouting: 1,
  char_spam: 1,
  emoji_spam: 1,
  mention_flood: 2,
  velocity: 3,
  reported_history: 3,
  reputation_credit: -3,
  premium_credit: -1,
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Trigram (character 3-gram) Jaccard similarity, 0..1. */
export const trigramSimilarity = (a: string, b: string): number => {
  const grams = (s: string) => {
    const t = `  ${normalise(s)} `
    const set = new Set<string>()
    for (let i = 0; i + 3 <= t.length; i++) set.add(t.slice(i, i + 3))
    return set
  }
  const ga = grams(a)
  const gb = grams(b)
  if (ga.size === 0 && gb.size === 0) return 1
  let inter = 0
  for (const g of ga) if (gb.has(g)) inter++
  return inter / (ga.size + gb.size - inter)
}

const EMOJI_RE = /\p{Extended_Pictographic}/gu

export const automod = (
  input: AutomodInput,
  now: Date = new Date(),
  thresholds: AutomodThresholds = DEFAULT_THRESHOLDS,
): AutomodResult => {
  const text = typeof input.body === 'string' ? input.body : plainText(input.body)
  const rules: AutomodRule[] = []
  const { author } = input

  const ageMs = now.getTime() - author.createdAt.getTime()
  if (ageMs < DAY) rules.push('new_account_24h')
  else if (ageMs < 7 * DAY) rules.push('new_account_7d')

  const links = detectLinks(text)
  const allowlisted = links.length > 0 && allAllowlisted(links, input.linkAllowlist ?? [])
  const hasLink = links.length > 0 && !allowlisted && !author.isStaff
  if (hasLink) rules.push('link_present')

  const recent = (input.recentBodies ?? []).map(normalise)
  const mine = normalise(text)
  if (mine && recent.includes(mine)) rules.push('repeated_text')
  else if (mine.length >= 20 && recent.some((r) => trigramSimilarity(r, mine) >= 0.8))
    rules.push('near_duplicate')

  const letters = text.replace(/[^\p{L}]/gu, '')
  if (letters.length >= 20) {
    const upper = letters.replace(/[^\p{Lu}]/gu, '').length
    if (upper / letters.length > 0.7) rules.push('shouting')
  }

  if (/(.)\1{7,}/u.test(text)) rules.push('char_spam')
  const emojiCount = (text.match(EMOJI_RE) ?? []).length
  if (emojiCount > 10 || (emojiCount >= 5 && emojiCount * 2 > text.length)) rules.push('emoji_spam')

  const mentionCount =
    typeof input.body === 'string'
      ? (text.match(/(?<![\w.])@[\w.]{2,}/g) ?? []).length
      : mentions(input.body).length
  if (mentionCount > 3) rules.push('mention_flood')

  const inLastMinute = (input.recentCommentTimes ?? []).filter(
    (t) => now.getTime() - t.getTime() <= 60_000,
  ).length
  if (inLastMinute > 3) rules.push('velocity')

  if (author.actionedReports30d >= 2) rules.push('reported_history')

  if (ageMs > 90 * DAY && author.publishedComments >= 50) rules.push('reputation_credit')
  if (author.isPremium) rules.push('premium_credit')

  const score = rules.reduce((s, r) => s + RULE_WEIGHTS[r], 0)

  let decision: AutomodDecision = 'publish'
  if (score >= thresholds.shadow && author.actionedReports30d > 0) decision = 'shadow'
  else if (score >= thresholds.hold) decision = 'hold'
  else if (hasLink && (input.holdLinks ?? true)) decision = 'hold'

  if (author.isStaff) decision = 'publish'

  return { score, rules, decision, hasLink, links }
}
