import { messages } from '@palscans/core/messages'
import { bookmarks, chapters, series } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { createDiscordBot, type DiscordBot, postWebhook } from '../discord/client'
import { newChapterMessage } from '../discord/embed'
import { linkedAccounts } from '../discord/link'
import { pushConfig } from './config'
import { type DeliveryInput, deliveredKeys, recordDeliveries } from './deliveries'
import {
  assembleDigest,
  digestCandidates,
  digestWindow,
  isDigestDue,
  markDigestRun,
  renderDigest,
} from './digest'
import type { Mailer } from './mail'
import { loadPrefs, prefAllows } from './prefs'
import { type PushPayload, type PushSender, sendPush } from './push'
import type { DigestFrequency, NotificationSettings } from './settings'
import type { FetchLike, NotifyDb } from './types'

/**
 * The fan-outs (docs/17 §D). Everything a channel needs is injected — the mailer, `fetch`,
 * the push sender, the clock — so the worker, the admin's test buttons and the unit tests all
 * drive the same code and none of them touch the network unless the caller wired one in.
 *
 * Every send writes the `notification_deliveries` ledger, including the ones **skipped**
 * because the reader turned that channel off, so `Admin → Community → Notifications` can
 * answer "what fired, and to whom".
 */
export interface SiteContext {
  siteUrl: string
  siteName: string
  cdnUrl?: string | null
}

export interface ChapterFanoutDeps {
  settings: NotificationSettings
  site: SiteContext
  fetchImpl?: FetchLike
  pushSender?: PushSender
  bot?: DiscordBot
  now?: Date
}

export interface ChapterFanoutSummary {
  chapterId: number
  push: { configured: boolean; sent: number; failed: number; skipped: number }
  discord: { webhooks: number; dms: number; failed: number }
}

const emptySummary = (chapterId: number): ChapterFanoutSummary => ({
  chapterId,
  push: { configured: false, sent: 0, failed: 0, skipped: 0 },
  discord: { webhooks: 0, dms: 0, failed: 0 },
})

/** The chapter a fan-out is about, with the series fields the embed needs. */
export const loadChapterForNotice = async (db: NotifyDb, chapterId: number) => {
  const [row] = await db
    .select({
      id: chapters.id,
      number: chapters.number,
      title: chapters.title,
      state: chapters.state,
      isPremium: chapters.isPremium,
      earlyAccessUntil: chapters.earlyAccessUntil,
      publishedAt: chapters.publishedAt,
      seriesId: series.id,
      seriesTitle: series.title,
      seriesSlug: series.slug,
      coverKey: series.coverKey,
    })
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(and(eq(chapters.id, chapterId), isNull(chapters.deletedAt), isNull(series.deletedAt)))
    .limit(1)
  return row ?? null
}

const coverUrl = (cdnUrl: string | null | undefined, key: string | null): string | null =>
  cdnUrl && key ? `${cdnUrl.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}` : null

/**
 * Push + Discord for one newly published chapter. In-app rows are written by the publisher
 * (`apps/worker/src/jobs/publish.ts`); this adds the channels that leave the site.
 *
 * Idempotent: a `dedupe_key` of `chapter:<id>:<channel>` means a re-run — a retried job, or a
 * second worker — sends nothing a second time.
 */
export const fanoutNewChapter = async (
  db: NotifyDb,
  chapterId: number,
  deps: ChapterFanoutDeps,
): Promise<ChapterFanoutSummary> => {
  const chapter = await loadChapterForNotice(db, chapterId)
  const summary = emptySummary(chapterId)
  if (!chapter || chapter.state !== 'published') return summary
  const now = deps.now ?? new Date()
  const locked =
    chapter.isPremium ||
    (chapter.earlyAccessUntil !== null && chapter.earlyAccessUntil.getTime() > now.getTime())
  const done = await deliveredKeys(db, [
    `chapter:${chapterId}:push`,
    `chapter:${chapterId}:discord`,
  ])

  // ── push ───────────────────────────────────────────────────────────────────────────────
  // A channel that cannot send is skipped *before* any query: an unconfigured deployment must
  // not pay for a bookmarker scan on every tick, and it must not write a ledger row either.
  const canPush =
    deps.settings.push.enabled && (deps.pushSender !== undefined || (await pushConfig()) !== null)
  if (canPush && !done.has(`chapter:${chapterId}:push`)) {
    const readers = await db
      .select({ userId: bookmarks.userId })
      .from(bookmarks)
      .where(eq(bookmarks.seriesId, chapter.seriesId))
    const ids = readers.map((r) => r.userId)
    const prefs = await loadPrefs(db, ids)
    const allowed = ids.filter((id) => prefAllows(prefs, id, 'new_chapter', 'push'))
    const skipped = ids.filter((id) => !allowed.includes(id))
    if (skipped.length)
      await recordDeliveries(
        db,
        skipped.map<DeliveryInput>((id) => ({
          userId: id,
          kind: 'new_chapter',
          channel: 'push',
          status: 'skipped',
          detail: 'preference off',
          dedupeKey: `chapter:${chapterId}:push`,
        })),
      )
    const payload: PushPayload = {
      title: chapter.seriesTitle,
      body: messages.notify.push.newChapter.replace('{n}', String(chapter.number)),
      url: locked
        ? `/series/${chapter.seriesSlug}`
        : `/series/${chapter.seriesSlug}/chapter-${chapter.number}`,
      tag: `series:${chapter.seriesId}`,
      kind: 'new_chapter',
    }
    const res = await sendPush(db, allowed, payload, {
      kind: 'new_chapter',
      ttlSeconds: deps.settings.push.ttlSeconds,
      dedupeKey: `chapter:${chapterId}:push`,
      sender: deps.pushSender,
    })
    summary.push = {
      configured: res.configured,
      sent: res.sent,
      failed: res.failed,
      skipped: skipped.length,
    }
  }

  // ── discord ────────────────────────────────────────────────────────────────────────────
  const bot = deps.bot ?? (await createDiscordBot({ fetchImpl: deps.fetchImpl }))
  const liveHooks = deps.settings.discord.webhooks.filter(
    (w) => w.enabled && w.events.includes('new_chapter'),
  )
  const canDiscord =
    deps.settings.discord.enabled &&
    (liveHooks.length > 0 || (deps.settings.discord.dms && bot.configured))
  if (canDiscord && !done.has(`chapter:${chapterId}:discord`)) {
    const message = newChapterMessage({
      siteName: deps.site.siteName,
      siteUrl: deps.site.siteUrl,
      seriesTitle: chapter.seriesTitle,
      seriesSlug: chapter.seriesSlug,
      number: chapter.number,
      chapterTitle: chapter.title,
      coverUrl: coverUrl(deps.site.cdnUrl, chapter.coverKey),
      publishedAt: chapter.publishedAt,
      locked,
    })
    const ledger: DeliveryInput[] = []
    for (const hook of liveHooks) {
      const res = await postWebhook(hook.url, message, deps.fetchImpl)
      if (res.ok) summary.discord.webhooks += 1
      else summary.discord.failed += 1
      ledger.push({
        kind: 'new_chapter',
        channel: 'discord',
        status: res.ok ? 'sent' : 'failed',
        target: hook.name,
        detail: res.error ?? null,
        dedupeKey: `chapter:${chapterId}:discord`,
      })
    }
    if (deps.settings.discord.dms && bot.configured) {
      const readers = await db
        .select({ userId: bookmarks.userId })
        .from(bookmarks)
        .where(eq(bookmarks.seriesId, chapter.seriesId))
      const ids = readers.map((r) => r.userId)
      const prefs = await loadPrefs(db, ids)
      const links = await linkedAccounts(db)
      for (const link of links) {
        if (!ids.includes(link.userId)) continue
        if (!prefAllows(prefs, link.userId, 'new_chapter', 'discord')) {
          ledger.push({
            userId: link.userId,
            kind: 'new_chapter',
            channel: 'discord',
            status: 'skipped',
            target: link.discordId,
            detail: 'preference off',
            dedupeKey: `chapter:${chapterId}:discord`,
          })
          continue
        }
        const res = await bot.dm(link.discordId, message)
        if (res.ok) summary.discord.dms += 1
        else summary.discord.failed += 1
        ledger.push({
          userId: link.userId,
          kind: 'new_chapter',
          channel: 'discord',
          status: res.ok ? 'sent' : 'failed',
          target: link.discordId,
          detail: res.error ?? null,
          dedupeKey: `chapter:${chapterId}:discord`,
        })
      }
    }
    await recordDeliveries(db, ledger)
  }
  return summary
}

// ── digest ───────────────────────────────────────────────────────────────────────────────

export interface DigestDeps {
  settings: NotificationSettings
  site: SiteContext
  mailer: Mailer
  now?: Date
  limit?: number
}

export interface DigestRunSummary {
  considered: number
  sent: number
  empty: number
  failed: number
  skipped: number
}

/**
 * One pass over everyone who opted in. A reader is mailed when their slot has passed, their
 * `new_chapter × email` preference is on, and the window actually holds something.
 */
export const runDigests = async (db: NotifyDb, deps: DigestDeps): Promise<DigestRunSummary> => {
  const now = deps.now ?? new Date()
  const out: DigestRunSummary = { considered: 0, sent: 0, empty: 0, failed: 0, skipped: 0 }
  if (!deps.settings.email.enabled) return out
  const schedule = {
    hourUtc: deps.settings.email.hourUtc,
    weeklyDay: deps.settings.email.weeklyDay,
  }
  const candidates = await digestCandidates(db, deps.limit ?? 500)
  for (const candidate of candidates) {
    const state = {
      frequency: candidate.frequency,
      lastSentAt: candidate.lastSentAt,
      lastCursorAt: candidate.lastCursorAt,
    }
    if (!isDigestDue(state, now, schedule)) continue
    out.considered += 1
    const prefs = await loadPrefs(db, [candidate.userId])
    if (!prefAllows(prefs, candidate.userId, 'new_chapter', 'email')) {
      out.skipped += 1
      await recordDeliveries(db, [
        {
          userId: candidate.userId,
          kind: 'new_chapter',
          channel: 'email',
          status: 'skipped',
          detail: 'preference off',
        },
      ])
      await markDigestRun(db, candidate.userId, now, 'empty')
      continue
    }
    const window = digestWindow(state, now)
    const digest = await assembleDigest(db, candidate.userId, {
      ...window,
      maxItems: deps.settings.email.maxItems,
    })
    if (digest.totalChapters === 0) {
      out.empty += 1
      await markDigestRun(db, candidate.userId, now, 'empty')
      continue
    }
    const rendered = renderDigest(digest, {
      siteUrl: deps.site.siteUrl,
      siteName: deps.site.siteName,
      displayName: candidate.displayName,
      frequency: candidate.frequency,
    })
    const res = await deps.mailer.send({
      to: candidate.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    })
    if (res.ok) out.sent += 1
    else out.failed += 1
    await recordDeliveries(db, [
      {
        userId: candidate.userId,
        kind: 'new_chapter',
        channel: 'email',
        status: res.ok ? 'sent' : 'failed',
        target: candidate.email.split('@')[1] ?? null,
        detail: res.error ?? `${digest.totalChapters} chapters`,
      },
    ])
    await markDigestRun(db, candidate.userId, now, res.ok ? 'sent' : 'failed')
  }
  return out
}

/**
 * The admin preview and "send test": assemble the *caller's own* digest over a fixed window,
 * so the operator sees a real mail built from real data rather than a mock-up.
 */
export const previewDigest = async (
  db: NotifyDb,
  userId: number,
  deps: {
    settings: NotificationSettings
    site: SiteContext
    displayName: string
    frequency?: DigestFrequency
    days?: number
    now?: Date
  },
) => {
  const now = deps.now ?? new Date()
  const days = deps.days ?? 7
  const window = { since: new Date(now.getTime() - days * 86_400_000), until: now }
  const digest = await assembleDigest(db, userId, {
    ...window,
    maxItems: deps.settings.email.maxItems,
  })
  const rendered = renderDigest(digest, {
    siteUrl: deps.site.siteUrl,
    siteName: deps.site.siteName,
    displayName: deps.displayName,
    frequency: deps.frequency ?? 'weekly',
  })
  return { digest, rendered }
}
