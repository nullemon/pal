import { parseEntitlementOverrides } from '@palscans/core'
import {
  bookmarks,
  chapters,
  type Db,
  getSetting,
  notificationPrefs,
  notifications,
  series,
  seriesFollows,
} from '@palscans/db'
import { and, asc, eq, inArray, isNull, lte } from 'drizzle-orm'
import { mergeFollowers, splitRecipients } from '../../../web/lib/notifications/index.js'
import { log } from '../lib/log.js'

/**
 * docs/04 "Scheduling": every 30 seconds publish anything whose `published_at` is due and fan
 * out `new_chapter` notifications to the readers following it. `series.last_chapter_at` is
 * maintained by the counter trigger (migration 0002), which is its only owner.
 *
 * Publishing is also where the early-access window is applied: a chapter opens Premium-only
 * for `entitlements.early_access_minutes` and then becomes free to everyone, without anyone
 * having to remember to set a date. A window already set by hand on the chapter wins, so a
 * longer run for one release still works.
 *
 * The series id travels back with each published chapter because the callers act on the
 * *series*: the catalogue cache purge, and the incremental sitemap build that has to know
 * which series/chapters files changed (docs/12 §5).
 */
export interface PublishedChapter {
  id: number
  seriesId: number
  number: number
}

export const publishDue = async (db: Db, now = new Date()): Promise<PublishedChapter[]> => {
  const overrides = parseEntitlementOverrides(await getSetting<unknown>(db, 'entitlements', {}))
  const windowMs = overrides.early_access_minutes * 60_000
  const earlyUntil = windowMs > 0 ? new Date(now.getTime() + windowMs) : null
  const due = await db
    .select({
      id: chapters.id,
      seriesId: chapters.seriesId,
      number: chapters.number,
      publishedAt: chapters.publishedAt,
      earlyAccessUntil: chapters.earlyAccessUntil,
    })
    .from(chapters)
    .where(
      and(
        eq(chapters.state, 'scheduled'),
        lte(chapters.publishedAt, now),
        isNull(chapters.deletedAt),
      ),
    )
    .orderBy(asc(chapters.publishedAt))
    .limit(200)
  const published: PublishedChapter[] = []
  for (const c of due) {
    try {
      await db.transaction(async (tx) => {
        const updated = await tx
          .update(chapters)
          .set({
            state: 'published',
            updatedAt: now,
            // Only when the operator has not set one themselves.
            ...(earlyUntil && !c.earlyAccessUntil ? { earlyAccessUntil: earlyUntil } : {}),
          })
          .where(and(eq(chapters.id, c.id), eq(chapters.state, 'scheduled')))
          .returning({ id: chapters.id })
        if (updated.length === 0) return
        await tx
          .update(series)
          .set({
            updatedAt: now,
          })
          .where(eq(series.id, c.seriesId))
        await notifyFollowers(tx, c.id, c.seriesId, c.number)
        published.push({ id: c.id, seriesId: c.seriesId, number: c.number })
      })
    } catch (err) {
      log.error(`publish ${c.id} failed`, err)
    }
  }
  if (published.length) log.info('published due chapters', { ids: published.map((c) => c.id) })
  return published
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * The in-app row for a chapter going live, to everyone **following** the series (docs/17 §D).
 *
 * Following is its own thing: `series_follows` decides, and a bookmark with no row there is
 * still an implicit follow on `all` — the behaviour every bookmarker had before follows
 * existed, so publishing this changed nobody's notifications. Two gates, both of which must
 * pass: the per-series `mode` (`followAllows`) and the reader's global `new_chapter × in_app`
 * preference (`prefAllows`, whose rows are sparse — a missing one means "on").
 */
export const notifyFollowers = async (
  tx: Tx | Db,
  chapterId: number,
  seriesId: number,
  number: number,
) => {
  const [s] = await tx
    .select({ title: series.title, slug: series.slug })
    .from(series)
    .where(eq(series.id, seriesId))
    .limit(1)
  const [follows, marks] = await Promise.all([
    tx
      .select({ userId: seriesFollows.userId, mode: seriesFollows.mode })
      .from(seriesFollows)
      .where(eq(seriesFollows.seriesId, seriesId)),
    tx.select({ userId: bookmarks.userId }).from(bookmarks).where(eq(bookmarks.seriesId, seriesId)),
  ])
  const followers = mergeFollowers(
    follows,
    marks.map((m) => m.userId),
  )
  if (followers.length === 0) return
  const ids = followers.map((f) => f.userId)
  const prefs = await tx
    .select({
      userId: notificationPrefs.userId,
      kind: notificationPrefs.kind,
      channel: notificationPrefs.channel,
      enabled: notificationPrefs.enabled,
    })
    .from(notificationPrefs)
    .where(inArray(notificationPrefs.userId, ids))
  const { allowed: recipients } = splitRecipients(followers, prefs, 'new_chapter', 'in_app')
  if (recipients.length === 0) return
  const payload = {
    chapterId,
    seriesId,
    number,
    seriesTitle: s?.title ?? '',
    seriesSlug: s?.slug ?? '',
  }
  await tx.insert(notifications).values(
    recipients.map((userId) => ({
      userId,
      kind: 'new_chapter',
      payload,
      groupKey: `series:${seriesId}`,
    })),
  )
}

/**
 * The name `chapter-process.ts` imports. It has always meant "tell the people who asked to
 * be told"; since follows exist that is `series_follows` with the bookmarks behind it, so
 * the alias points at the same fan-out rather than at a second, bookmark-only one.
 */
export const notifyBookmarkers = notifyFollowers
