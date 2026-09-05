import { messages } from '@palscans/core/messages'
import {
  bookmarks,
  chapterReads,
  chapters,
  notificationDigestState,
  readingProgress,
  series,
  users,
} from '@palscans/db'
import { and, asc, eq, gt, inArray, isNull, lte, notExists, sql } from 'drizzle-orm'
import { digestFollowedSeries, digestMutedSeries } from './follows'
import type { DigestFrequency } from './settings'
import type { NotifyDb } from './types'

/**
 * The email digest (docs/17 §D): a daily or weekly "new chapters for you", assembled from
 * bookmarks *and* reading progress, minus anything the reader already opened.
 *
 * The scheduling, grouping and rendering below are pure functions over plain rows — the only
 * database calls are `collectDigestRows` and the two state helpers — so the interesting parts
 * are unit-tested without a database and without a network (`digest.test.ts`).
 */

/** One published chapter a reader has not read yet. */
export interface DigestRow {
  chapterId: number
  number: number
  chapterTitle: string | null
  seriesId: number
  seriesTitle: string
  seriesSlug: string
  publishedAt: Date
  isPremium: boolean
  earlyAccessUntil: Date | null
}

export interface DigestChapter {
  chapterId: number
  number: number
  title: string | null
  /** Site-relative; a locked chapter points at the series page, never at a page it cannot open. */
  href: string
  locked: boolean
  publishedAt: Date
}

export interface DigestSeries {
  seriesId: number
  title: string
  slug: string
  href: string
  chapters: DigestChapter[]
  /** Chapters of this series beyond the cap. */
  more: number
}

export interface Digest {
  series: DigestSeries[]
  /** Every chapter found, before the cap. */
  totalChapters: number
  totalSeries: number
  /** Chapters not listed because of the cap. */
  hidden: number
  since: Date
  until: Date
}

export interface DigestState {
  frequency: DigestFrequency
  lastSentAt: Date | null
  lastCursorAt: Date | null
}

export interface DigestSchedule {
  hourUtc: number
  weeklyDay: number
}

/**
 * Is this reader's digest due? Daily fires once the UTC send-hour has passed and the last
 * send was on an earlier day; weekly additionally waits for the configured weekday. A run
 * that was missed (worker down, no chapters) is caught up on the next tick rather than
 * skipped, because the test is "last send is older than the last scheduled slot", not "now
 * is exactly the slot".
 */
export const isDigestDue = (state: DigestState, now: Date, schedule: DigestSchedule): boolean => {
  if (state.frequency === 'off') return false
  const slot = lastScheduledSlot(state.frequency, now, schedule)
  if (!slot) return false
  if (!state.lastSentAt) return true
  return state.lastSentAt.getTime() < slot.getTime()
}

/** The most recent moment the digest should have gone out, at or before `now`. */
export const lastScheduledSlot = (
  frequency: DigestFrequency,
  now: Date,
  schedule: DigestSchedule,
): Date | null => {
  if (frequency === 'off') return null
  const slot = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), schedule.hourUtc, 0, 0, 0),
  )
  if (frequency === 'daily') {
    if (slot.getTime() > now.getTime()) slot.setUTCDate(slot.getUTCDate() - 1)
    return slot
  }
  // weekly: walk back to the configured weekday, then back one more week if still ahead
  const back = (slot.getUTCDay() - schedule.weeklyDay + 7) % 7
  slot.setUTCDate(slot.getUTCDate() - back)
  if (slot.getTime() > now.getTime()) slot.setUTCDate(slot.getUTCDate() - 7)
  return slot
}

/** The window a run covers: from the reader's watermark (or a sensible default) to now. */
export const digestWindow = (state: DigestState, now: Date): { since: Date; until: Date } => {
  const fallbackDays = state.frequency === 'weekly' ? 7 : 1
  const since =
    state.lastCursorAt ?? state.lastSentAt ?? new Date(now.getTime() - fallbackDays * 86_400_000)
  return { since, until: now }
}

const chapterHref = (slug: string, number: number) => `/series/${slug}/chapter-${number}`

const isLocked = (row: DigestRow, now: Date) =>
  row.isPremium || (row.earlyAccessUntil !== null && row.earlyAccessUntil.getTime() > now.getTime())

/**
 * Group the rows by series, newest series first, chapters ascending inside a series, and cap
 * the whole digest at `maxItems` chapters — the overflow is counted, never silently dropped.
 */
export const buildDigest = (
  rows: readonly DigestRow[],
  opts: { since: Date; until: Date; maxItems: number; now?: Date },
): Digest => {
  const now = opts.now ?? opts.until
  const bySeries = new Map<number, DigestRow[]>()
  for (const row of rows) {
    const list = bySeries.get(row.seriesId)
    if (list) list.push(row)
    else bySeries.set(row.seriesId, [row])
  }
  const ordered = [...bySeries.values()].sort((a, b) => {
    const latest = (rs: DigestRow[]) => Math.max(...rs.map((r) => r.publishedAt.getTime()))
    return latest(b) - latest(a)
  })
  let budget = Math.max(1, opts.maxItems)
  let hidden = 0
  const out: DigestSeries[] = []
  for (const group of ordered) {
    const sorted = [...group].sort((a, b) => a.number - b.number)
    const take = Math.max(0, Math.min(budget, sorted.length))
    const shown = sorted.slice(sorted.length - take) // the newest ones fit first
    budget -= take
    hidden += sorted.length - take
    const head = sorted[0]
    if (!head) continue
    out.push({
      seriesId: head.seriesId,
      title: head.seriesTitle,
      slug: head.seriesSlug,
      href: `/series/${head.seriesSlug}`,
      more: sorted.length - take,
      chapters: shown.map((r) => {
        const locked = isLocked(r, now)
        return {
          chapterId: r.chapterId,
          number: r.number,
          title: r.chapterTitle,
          href: locked ? `/series/${r.seriesSlug}` : chapterHref(r.seriesSlug, r.number),
          locked,
          publishedAt: r.publishedAt,
        }
      }),
    })
  }
  return {
    series: out.filter((s) => s.chapters.length > 0),
    totalChapters: rows.length,
    totalSeries: bySeries.size,
    hidden,
    since: opts.since,
    until: opts.until,
  }
}

/**
 * Everything published in the window on a series the reader follows, bookmarked (anything
 * but `dropped`) or is part-way through, minus the chapters they already read.
 *
 * The three sources are a union and the per-series setting is a veto over all of them
 * (`digestMutedSeries`): a reader who set one series to `push` or `off` must not find it in
 * the mail because they also have reading progress on it.
 */
export const collectDigestRows = async (
  db: NotifyDb,
  userId: number,
  since: Date,
  until: Date,
): Promise<DigestRow[]> => {
  const followed = digestFollowedSeries(db, userId)
    .union(
      db
        .select({ seriesId: bookmarks.seriesId })
        .from(bookmarks)
        .where(and(eq(bookmarks.userId, userId), sql`${bookmarks.status} <> 'dropped'`)),
    )
    .union(
      db
        .select({ seriesId: readingProgress.seriesId })
        .from(readingProgress)
        .where(eq(readingProgress.userId, userId)),
    )
  return db
    .select({
      chapterId: chapters.id,
      number: chapters.number,
      chapterTitle: chapters.title,
      seriesId: series.id,
      seriesTitle: series.title,
      seriesSlug: series.slug,
      publishedAt: sql<Date>`${chapters.publishedAt}`,
      isPremium: chapters.isPremium,
      earlyAccessUntil: chapters.earlyAccessUntil,
    })
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(
      and(
        eq(chapters.state, 'published'),
        isNull(chapters.deletedAt),
        isNull(series.deletedAt),
        gt(chapters.publishedAt, since),
        lte(chapters.publishedAt, until),
        inArray(chapters.seriesId, followed),
        digestMutedSeries(userId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(chapterReads)
            .where(and(eq(chapterReads.userId, userId), eq(chapterReads.chapterId, chapters.id))),
        ),
      ),
    )
    .orderBy(asc(series.title), asc(chapters.number))
    .limit(200)
}

/** Assemble one reader's digest for a window (empty digests are still returned, not null). */
export const assembleDigest = async (
  db: NotifyDb,
  userId: number,
  opts: { since: Date; until: Date; maxItems: number },
): Promise<Digest> => buildDigest(await collectDigestRows(db, userId, opts.since, opts.until), opts)

// ── rendering ────────────────────────────────────────────────────────────────────────────

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )

const chapterLabel = (c: DigestChapter): string => {
  const m = messages.notify.digest
  const n = m.chapter.replace('{n}', String(c.number))
  return c.title ? `${n} — ${c.title}` : n
}

export interface RenderedDigest {
  subject: string
  text: string
  html: string
}

/**
 * The mail body. Colours are literal here on purpose: an email client has no access to the
 * appearance tokens, and docs/16's "no literal colours" rule is about components — the
 * existing `lib/email/templates.ts` inlines the same palette for the same reason.
 */
export const renderDigest = (
  digest: Digest,
  opts: { siteUrl: string; siteName: string; displayName: string; frequency: DigestFrequency },
): RenderedDigest => {
  const m = messages.notify.digest
  const base = opts.siteUrl.replace(/\/+$/, '')
  const abs = (path: string) => `${base}${path}`
  const period = opts.frequency === 'weekly' ? m.periodWeekly : m.periodDaily
  const subject = m.subject
    .replace('{n}', String(digest.totalChapters))
    .replace('{series}', String(digest.totalSeries))
  const lines: string[] = [m.greeting.replace('{name}', opts.displayName), '', period, '']
  for (const s of digest.series) {
    lines.push(`${s.title}`)
    for (const c of s.chapters)
      lines.push(`  · ${chapterLabel(c)}${c.locked ? ` (${m.locked})` : ''} — ${abs(c.href)}`)
    if (s.more > 0) lines.push(`  · ${m.more.replace('{n}', String(s.more))}`)
    lines.push('')
  }
  lines.push(m.manage, abs('/me/notifications'))

  const seriesHtml = digest.series
    .map(
      (s) =>
        `<tr><td style="padding:14px 0;border-bottom:1px solid #2c2540">
<a href="${escapeHtml(abs(s.href))}" style="color:#ece9f4;font-weight:700;text-decoration:none;font-size:15px">${escapeHtml(s.title)}</a>
<div style="margin-top:6px">${s.chapters
          .map(
            (c) =>
              `<div style="margin:3px 0"><a href="${escapeHtml(abs(c.href))}" style="color:#8b5cf6;text-decoration:none;font-size:13px">${escapeHtml(chapterLabel(c))}</a>${
                c.locked
                  ? ` <span style="color:#f5c451;font-size:11px;font-weight:700">${escapeHtml(m.locked)}</span>`
                  : ''
              }</div>`,
          )
          .join('')}${
          s.more > 0
            ? `<div style="margin:3px 0;color:#9e97b8;font-size:12px">${escapeHtml(m.more.replace('{n}', String(s.more)))}</div>`
            : ''
        }</div></td></tr>`,
    )
    .join('')

  const html = `<!doctype html><html><body style="margin:0;background:#100d17;color:#ece9f4;font-family:ui-sans-serif,system-ui,sans-serif;padding:32px"><div style="max-width:560px;margin:0 auto;background:#181423;border:1px solid #2c2540;border-radius:14px;padding:28px"><p style="margin:0 0 20px;font-weight:800;letter-spacing:-.02em;font-size:18px">${escapeHtml(opts.siteName)}</p><h1 style="font-size:20px;margin:0 0 6px">${escapeHtml(subject)}</h1><p style="margin:0 0 14px;color:#9e97b8;font-size:13px">${escapeHtml(period)}</p><table style="width:100%;border-collapse:collapse">${seriesHtml}</table><p style="margin:22px 0 0;font-size:12px;color:#6f6890">${escapeHtml(m.manage)} <a href="${escapeHtml(abs('/me/notifications'))}" style="color:#8b5cf6">${escapeHtml(abs('/me/notifications'))}</a></p></div></body></html>`

  return { subject, text: lines.join('\n'), html }
}

// ── per-reader state ─────────────────────────────────────────────────────────────────────

export interface DigestCandidate {
  userId: number
  email: string
  displayName: string
  frequency: DigestFrequency
  lastSentAt: Date | null
  lastCursorAt: Date | null
}

/** Readers who opted in to a digest (`frequency <> 'off'`) and still have a live account. */
export const digestCandidates = async (db: NotifyDb, limit = 500): Promise<DigestCandidate[]> => {
  const rows = await db
    .select({
      userId: notificationDigestState.userId,
      email: users.email,
      username: users.username,
      displayName: users.displayName,
      frequency: notificationDigestState.frequency,
      lastSentAt: notificationDigestState.lastSentAt,
      lastCursorAt: notificationDigestState.lastCursorAt,
    })
    .from(notificationDigestState)
    .innerJoin(users, eq(users.id, notificationDigestState.userId))
    .where(
      and(
        sql`${notificationDigestState.frequency} <> 'off'`,
        isNull(users.deletedAt),
        isNull(users.deletionRequestedAt),
      ),
    )
    .limit(limit)
  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    displayName: r.displayName ?? r.username ?? messages.notify.digest.reader,
    frequency: (r.frequency as DigestFrequency) ?? 'off',
    lastSentAt: r.lastSentAt,
    lastCursorAt: r.lastCursorAt,
  }))
}

export const readDigestState = async (db: NotifyDb, userId: number): Promise<DigestState> => {
  const [row] = await db
    .select({
      frequency: notificationDigestState.frequency,
      lastSentAt: notificationDigestState.lastSentAt,
      lastCursorAt: notificationDigestState.lastCursorAt,
    })
    .from(notificationDigestState)
    .where(eq(notificationDigestState.userId, userId))
    .limit(1)
  return {
    frequency: (row?.frequency as DigestFrequency) ?? 'off',
    lastSentAt: row?.lastSentAt ?? null,
    lastCursorAt: row?.lastCursorAt ?? null,
  }
}

export const setDigestFrequency = async (
  db: NotifyDb,
  userId: number,
  frequency: DigestFrequency,
): Promise<void> => {
  const now = new Date()
  await db
    .insert(notificationDigestState)
    .values({ userId, frequency, updatedAt: now, lastCursorAt: now })
    .onConflictDoUpdate({
      target: notificationDigestState.userId,
      set: { frequency, updatedAt: now },
    })
}

/**
 * Close a run. `lastSentAt` is the *run* watermark `isDigestDue` reads, so it always moves —
 * otherwise a reader with nothing new would be re-assembled on every tick. `lastCursorAt` is
 * the *content* watermark and only moves when the mail actually left, so a failed send is
 * retried at the next slot with the same chapters instead of losing them.
 */
export const markDigestRun = async (
  db: NotifyDb,
  userId: number,
  until: Date,
  outcome: 'sent' | 'empty' | 'failed',
): Promise<void> => {
  const advanceCursor = outcome !== 'failed'
  await db
    .insert(notificationDigestState)
    .values({
      userId,
      frequency: 'daily',
      lastCursorAt: advanceCursor ? until : null,
      lastSentAt: until,
      updatedAt: until,
    })
    .onConflictDoUpdate({
      target: notificationDigestState.userId,
      set: advanceCursor
        ? { lastCursorAt: until, lastSentAt: until, updatedAt: until }
        : { lastSentAt: until, updatedAt: until },
    })
}
