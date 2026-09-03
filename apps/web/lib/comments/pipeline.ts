import { type EntitlementOverrides, entitlement, isStaff } from '@palscans/core'
import {
  automod,
  type BlockNode,
  COMMENT_MAX_CHARS,
  type CommentBody,
  type InlineNode,
  imageIds,
  linkHrefs,
  mentions as mentionsOf,
  misleadingLinks,
  plainText,
} from '@palscans/core/comments'
import {
  bans,
  chapters,
  commentMentions,
  comments,
  communityImages,
  type Db,
  linkAllowlist,
  reports,
  series,
  users,
  wordFilters,
} from '@palscans/db'
import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import type { RateLimiter } from './rate-limit'
import type { CommentSettings } from './settings'
import type { CommentTarget } from './types'
import type { AppUser } from './viewer'

/**
 * docs/14 §2 — the submit pipeline, in order:
 *   account gate → rate limit → Turnstile → link policy → word filters → automod
 *   → duplicate check → published | pending | shadow | rejected.
 * Turnstile (step 3) is demanded for accounts under 7 days old, after a rate-limit hit in
 * the last hour, and site-wide under lockdown; the token is verified server-side.
 */

export type RejectCode =
  | 'disabled'
  | 'unverified'
  | 'banned'
  | 'too_new'
  | 'rate_limited'
  | 'turnstile'
  | 'too_long'
  | 'empty'
  | 'too_many_mentions'
  | 'blocked_words'
  | 'misleading_link'
  | 'invalid_image'
  | 'not_found'
  | 'locked'

export type SubmitOutcome =
  | { ok: true; id: number; status: 'published' | 'pending' | 'shadow'; hasLink: boolean }
  | { ok: false; code: RejectCode; retryAfterSec?: number }

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// ---- pure steps (unit-tested) ------------------------------------------------------------

export interface GateUser {
  emailVerifiedAt: Date | null
  commentBannedUntil: Date | null
  createdAt: Date
  role: AppUser['role']
}

/** Step 1 — verified email, not comment-banned, minimum account age. Staff skip the age rule. */
export const accountGate = (
  user: GateUser,
  settings: CommentSettings,
  now: Date = new Date(),
): RejectCode | null => {
  if (!settings.enabled) return 'disabled'
  if (settings.require_verified_email && !user.emailVerifiedAt) return 'unverified'
  if (user.commentBannedUntil && user.commentBannedUntil.getTime() > now.getTime()) return 'banned'
  const staff = user.role === 'admin' || user.role === 'moderator'
  const ageMin = (now.getTime() - user.createdAt.getTime()) / MINUTE
  if (!staff && ageMin < settings.min_account_age_minutes) return 'too_new'
  return null
}

export interface WordFilter {
  pattern: string
  isRegex: boolean
  action: string
  replacement: string | null
}

export interface WordFilterResult {
  action: 'block' | 'hold' | 'none'
  body: CommentBody
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const compile = (f: WordFilter): RegExp | null => {
  try {
    return f.isRegex
      ? new RegExp(f.pattern, 'giu')
      : new RegExp(`\\b${escapeRe(f.pattern)}\\b`, 'giu')
  } catch {
    return null
  }
}

const mapText = (node: BlockNode, fn: (t: string) => string): BlockNode => {
  const inline = (n: InlineNode): InlineNode => {
    switch (n.type) {
      case 'text':
        return { ...n, text: fn(n.text) }
      case 'spoiler':
        return { ...n, children: n.children.map(inline) }
      case 'link':
        return { ...n, children: n.children.map(inline) }
      default:
        return n
    }
  }
  switch (node.type) {
    case 'paragraph':
      return { ...node, children: node.children.map(inline) }
    case 'quote':
      return { ...node, children: node.children.map((c) => mapText(c, fn)) }
    default:
      return node
  }
}

/** Step 5 — block list → rejected · hold list → pending · replace list → masked. */
export const applyWordFilters = (
  body: CommentBody,
  filters: readonly WordFilter[],
): WordFilterResult => {
  const text = plainText(body)
  let hold = false
  let out = body
  for (const f of filters) {
    const re = compile(f)
    if (!re) continue
    re.lastIndex = 0
    if (!re.test(text)) continue
    if (f.action === 'block') return { action: 'block', body }
    if (f.action === 'hold') hold = true
    if (f.action === 'replace') {
      const replacement = f.replacement ?? '***'
      out = {
        ...out,
        children: out.children.map((b) =>
          mapText(b, (t) => {
            const r = compile(f)
            return r ? t.replace(r, replacement) : t
          }),
        ),
      }
    }
  }
  return { action: hold ? 'hold' : 'none', body: out }
}

export const normaliseText = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Step 7 — same body from the same user (10 min) or the same body across users → hold. */
export const isDuplicate = (
  text: string,
  ownRecent: readonly string[],
  othersRecent: readonly string[],
): boolean => {
  const mine = normaliseText(text)
  if (!mine) return false
  return (
    ownRecent.some((r) => normaliseText(r) === mine) ||
    othersRecent.some((r) => normaliseText(r) === mine)
  )
}

export type BanKind = 'user' | 'shadow'

/** Active bans on a user: `user` ends the request, `shadow` publishes to the author only. */
export const loadActiveBans = async (
  db: Db,
  userId: number,
  now: Date = new Date(),
): Promise<Set<BanKind>> => {
  const rows = await db
    .select({ kind: bans.kind })
    .from(bans)
    .where(
      and(
        inArray(bans.kind, ['user', 'shadow']),
        eq(bans.value, String(userId)),
        isNull(bans.revokedAt),
        or(isNull(bans.expiresAt), gt(bans.expiresAt, now)),
      ),
    )
  return new Set(rows.map((r) => r.kind as BanKind))
}

/**
 * docs/14 §5 — every referenced image must be an approved community image the author may
 * use: one from the collection, or their own approved upload. Shared by submit and edit.
 */
export const commentImagesUsable = async (
  db: Db,
  ids: readonly number[],
  userId: number,
  settings: CommentSettings,
): Promise<boolean> => {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return true
  if (!settings.images.collection) return false
  const rows = await db
    .select({
      id: communityImages.id,
      status: communityImages.status,
      uploadedBy: communityImages.uploadedBy,
      isCollection: communityImages.isCollection,
    })
    .from(communityImages)
    .where(inArray(communityImages.id, unique))
  const usable = new Set(
    rows
      .filter((img) => img.status === 'approved' && (img.isCollection || img.uploadedBy === userId))
      .map((img) => img.id),
  )
  return unique.every((id) => usable.has(id))
}

const isFreshAccount = (user: { createdAt: Date }, now: Date) =>
  now.getTime() - user.createdAt.getTime() < 7 * DAY

/** Step 3 — who must pass the invisible challenge: new accounts, recently limited, or everyone under lockdown. */
export const challengeRequired = (
  user: { createdAt: Date },
  settings: CommentSettings,
  recentlyLimited: boolean,
  now: Date = new Date(),
): boolean => settings.lockdown || recentlyLimited || isFreshAccount(user, now)

/** Marks a user as rate-limited for an hour, so their next attempts need the challenge. */
export const limitedKey = (userId: number) => `comments:u:${userId}:limited`

export const rateLimitsFor = (user: { createdAt: Date }, settings: CommentSettings, now: Date) => {
  const fresh = isFreshAccount(user, now)
  return {
    perMinute: fresh ? settings.rate_limits.new_per_minute : settings.rate_limits.per_minute,
    perHour: fresh ? settings.rate_limits.new_per_hour : settings.rate_limits.per_hour,
  }
}

// ---- the full pipeline ----------------------------------------------------------------------

/** The Turnstile hook: `enabled` mirrors TURNSTILE_SECRET_KEY, `verify` calls siteverify. */
export interface CommentChallenge {
  enabled: boolean
  token: string | undefined
  verify: (token: string | undefined) => Promise<boolean>
}

export interface SubmitInput {
  db: Db
  settings: CommentSettings
  user: AppUser
  target: CommentTarget
  parentId: number | null
  body: CommentBody
  imageId: number | null
  isSpoiler: boolean
  ipHash: Uint8Array | null
  limiter: RateLimiter
  challenge?: CommentChallenge
  now?: Date
  /** `settings.entitlements` overrides (docs/17 §B); null keeps the entitlement check. */
  overrides?: EntitlementOverrides | null
}

export const submitComment = async (input: SubmitInput): Promise<SubmitOutcome> => {
  const { db, settings, user, target, limiter } = input
  const now = input.now ?? new Date()
  const staff = isStaff(user)

  // 1. account gate
  const gate = accountGate(user, settings, now)
  if (gate) return { ok: false, code: gate }
  const activeBans = await loadActiveBans(db, user.id, now)
  if (activeBans.has('user')) return { ok: false, code: 'banned' }
  // docs/14 §3: a shadow-banned author sees their comments as published; nobody else does.
  const shadowBanned = activeBans.has('shadow') && !staff

  // target must exist, allow comments and (for replies) the parent must be open
  let seriesId: number | null = null
  let chapterId: number | null = null
  if (target.kind === 'series') {
    const [s] = await db
      .select({ id: series.id, enabled: series.commentsEnabled })
      .from(series)
      .where(and(eq(series.id, target.id), eq(series.state, 'published'), isNull(series.deletedAt)))
      .limit(1)
    if (!s) return { ok: false, code: 'not_found' }
    if (!s.enabled) return { ok: false, code: 'disabled' }
    seriesId = s.id
  } else {
    const [c] = await db
      .select({ id: chapters.id, seriesId: chapters.seriesId, enabled: series.commentsEnabled })
      .from(chapters)
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .where(
        and(
          eq(chapters.id, target.id),
          eq(chapters.state, 'published'),
          isNull(chapters.deletedAt),
        ),
      )
      .limit(1)
    if (!c) return { ok: false, code: 'not_found' }
    if (!c.enabled) return { ok: false, code: 'disabled' }
    seriesId = c.seriesId
    chapterId = c.id
  }
  if (input.parentId !== null) {
    const [parent] = await db
      .select({
        id: comments.id,
        parentId: comments.parentId,
        locked: comments.locked,
        status: comments.status,
        seriesId: comments.seriesId,
        chapterId: comments.chapterId,
      })
      .from(comments)
      .where(and(eq(comments.id, input.parentId), isNull(comments.deletedAt)))
      .limit(1)
    if (parent?.status !== 'published') return { ok: false, code: 'not_found' }
    if (parent.parentId !== null) return { ok: false, code: 'not_found' } // one level only
    // The parent has to live on the target the checks above were run against. Without this a
    // reply could name any comment id and be stored against a *different* series — which
    // walked straight past that series' comments-disabled gate, and left the row attributed
    // to the wrong series for moderation, duplicate detection and notification routing.
    if (parent.seriesId !== seriesId || parent.chapterId !== chapterId)
      return { ok: false, code: 'not_found' }
    if (parent.locked && !staff) return { ok: false, code: 'locked' }
  }

  // body limits
  const text = plainText(input.body)
  if (text.trim().length === 0 && imageIds(input.body).length === 0 && !input.imageId)
    return { ok: false, code: 'empty' }
  if (text.length > COMMENT_MAX_CHARS) return { ok: false, code: 'too_long' }
  const mentioned = mentionsOf(input.body)
  if (mentioned.length > settings.max_mentions) return { ok: false, code: 'too_many_mentions' }
  // link nodes whose label is a different address than their href are only for staff
  if (!staff && misleadingLinks(input.body).length > 0)
    return { ok: false, code: 'misleading_link' }

  const imageId = input.imageId ?? imageIds(input.body)[0] ?? null
  if (imageId !== null && !(await commentImagesUsable(db, [imageId], user.id, settings)))
    return { ok: false, code: 'invalid_image' }

  // 2. rate limits (per user; stricter for accounts < 7 days); a hit flags the user for step 3
  if (!staff) {
    const limits = rateLimitsFor(user, settings, now)
    const minute = await limiter.hit(`comments:u:${user.id}:m`, limits.perMinute, 60)
    const hour = minute.ok
      ? await limiter.hit(`comments:u:${user.id}:h`, limits.perHour, 3600)
      : minute
    if (!minute.ok || !hour.ok) {
      await limiter.hit(limitedKey(user.id), 1, 3600)
      const retryAfterSec = minute.ok ? hour.retryAfterSec : minute.retryAfterSec
      return { ok: false, code: 'rate_limited', retryAfterSec }
    }
  }

  // 3. Turnstile (docs/14 §2, §6): new accounts, after a rate-limit hit, or under lockdown
  if (!staff && input.challenge?.enabled) {
    const recentlyLimited = (await limiter.count(limitedKey(user.id))) > 0
    if (
      challengeRequired(user, settings, recentlyLimited, now) &&
      !(await input.challenge.verify(input.challenge.token))
    )
      return { ok: false, code: 'turnstile' }
  }

  // 5. word filters (before automod so masked text is what gets scored)
  const filters = await db
    .select({
      pattern: wordFilters.pattern,
      isRegex: wordFilters.isRegex,
      action: wordFilters.action,
      replacement: wordFilters.replacement,
    })
    .from(wordFilters)
    .where(isNull(wordFilters.deletedAt))
  const filtered = applyWordFilters(input.body, filters)
  if (filtered.action === 'block') return { ok: false, code: 'blocked_words' }
  const body = filtered.body
  let hold = filtered.action === 'hold'

  // author signals for automod + duplicate check
  const since10m = new Date(now.getTime() - 10 * MINUTE)
  const [own, others, [publishedRow], [reportsRow], allow] = await Promise.all([
    db
      .select({ body: comments.body, createdAt: comments.createdAt })
      .from(comments)
      .where(and(eq(comments.userId, user.id), gt(comments.createdAt, since10m)))
      .orderBy(desc(comments.createdAt))
      .limit(20),
    db
      .select({ body: comments.body })
      .from(comments)
      .where(
        and(
          seriesId !== null && chapterId === null
            ? eq(comments.seriesId, seriesId)
            : eq(comments.chapterId, chapterId ?? 0),
          gt(comments.createdAt, since10m),
          sql`${comments.userId} <> ${user.id}`,
        ),
      )
      .orderBy(desc(comments.createdAt))
      .limit(50),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(comments)
      .where(
        and(
          eq(comments.userId, user.id),
          eq(comments.status, 'published'),
          isNull(comments.deletedAt),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(reports)
      .innerJoin(comments, eq(comments.id, reports.targetId))
      .where(
        and(
          eq(reports.targetType, 'comment'),
          eq(reports.status, 'actioned'),
          eq(comments.userId, user.id),
          gt(reports.handledAt, new Date(now.getTime() - 30 * DAY)),
        ),
      ),
    db
      .select({ domain: linkAllowlist.domain })
      .from(linkAllowlist)
      .where(isNull(linkAllowlist.deletedAt)),
  ])
  const ownTexts = own.map((r) => plainText(r.body as CommentBody))
  const otherTexts = others.map((r) => plainText(r.body as CommentBody))
  const publishedComments = Number(publishedRow?.n ?? 0)
  const actionedReports30d = Number(reportsRow?.n ?? 0)

  // 4 + 6. link policy and automod scoring (links are held by default). Link-node hrefs are
  // scanned with the text so a `{type:'link'}` node cannot slip past the hold policy.
  const result = automod(
    {
      body,
      hrefs: linkHrefs(body),
      author: {
        createdAt: user.createdAt,
        publishedComments,
        actionedReports30d,
        isPremium:
          entitlement(user, 'priority_comments', { overrides: input.overrides ?? null, now }) ||
          user.role === 'premium',
        isStaff: staff,
      },
      recentBodies: ownTexts,
      recentCommentTimes: own.map((r) => r.createdAt),
      linkAllowlist: allow.map((a) => a.domain),
      holdLinks: settings.hold_links,
    },
    now,
    settings.automod,
  )
  let status: 'published' | 'pending' | 'shadow' = 'published'
  if (result.decision === 'shadow') status = 'shadow'
  else if (result.decision === 'hold' || hold) status = 'pending'

  // young accounts: the first N comments are held (docs/14 §3)
  if (!staff && status === 'published') {
    const ageHours = (now.getTime() - user.createdAt.getTime()) / HOUR
    if (
      ageHours < settings.hold_new_accounts_hours &&
      publishedComments < settings.hold_new_accounts_first_n
    )
      status = 'pending'
  }

  // 7. duplicate check → hold
  if (!staff && status === 'published' && isDuplicate(text, ownTexts, otherTexts)) {
    hold = true
    status = 'pending'
  }
  if (settings.lockdown && !staff && status === 'published') status = 'pending'
  // A shadow-banned author must see nothing unusual: no holds, no review notices.
  if (shadowBanned) status = 'shadow'

  const [inserted] = await db
    .insert(comments)
    .values({
      userId: user.id,
      seriesId,
      chapterId,
      parentId: input.parentId,
      body,
      isSpoiler: input.isSpoiler,
      status,
      automodScore: result.score,
      automodRules:
        hold && !result.rules.includes('link_present')
          ? [...result.rules, 'word_filter']
          : result.rules,
      hasLink: result.hasLink,
      imageId,
      ipHash: input.ipHash,
      createdAt: now,
    })
    .returning({ id: comments.id })
  if (!inserted) throw new Error('comment insert returned no row')

  if (mentioned.length > 0) {
    const targets = await db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.username, mentioned), isNull(users.deletedAt)))
    if (targets.length)
      await db
        .insert(commentMentions)
        .values(targets.map((t) => ({ commentId: inserted.id, userId: t.id })))
        .onConflictDoNothing()
  }

  return { ok: true, id: inserted.id, status, hasLink: result.hasLink }
}

/** docs/14 §1 — edit within the window (staff any time). */
export const canEditComment = (
  row: { userId: number; createdAt: Date; deletedAt: Date | null },
  user: AppUser,
  settings: CommentSettings,
  now: Date = new Date(),
): boolean => {
  if (row.deletedAt) return false
  if (isStaff(user)) return true
  if (row.userId !== user.id) return false
  return now.getTime() - row.createdAt.getTime() <= settings.edit_window_minutes * MINUTE
}
