import { parseEntitlementOverrides } from '@palscans/core'
import {
  bookmarks,
  chapters,
  type Db,
  getSetting,
  notificationPrefs,
  notifications,
  series,
} from '@palscans/db'
import { and, asc, eq, inArray, isNull, lte } from 'drizzle-orm'
import { prefAllows } from '../../../web/lib/notifications/index.js'
import { log } from '../lib/log.js'

/**
 * docs/04 "Scheduling": every 30 seconds publish anything whose `published_at` is due and fan
 * out `new_chapter` notifications to bookmarkers. `series.last_chapter_at` is maintained by
 * the counter trigger (migration 0002), which is its only owner.
 *
 * Publishing is also where the early-access window is applied: a chapter opens Premium-only
 * for `entitlements.early_access_minutes` and then becomes free to everyone, without anyone
 * having to remember to set a date. A window already set by hand on the chapter wins, so a
 * longer run for one release still works.
 */
export const publishDue = async (db: Db, now = new Date()): Promise<number[]> => {
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
  const published: number[] = []
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
        await notifyBookmarkers(tx, c.id, c.seriesId, c.number)
        published.push(c.id)
      })
    } catch (err) {
      log.error(`publish ${c.id} failed`, err)
    }
  }
  if (published.length) log.info('published due chapters', { ids: published })
  return published
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

export const notifyBookmarkers = async (
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
  const readers = await tx
    .select({ userId: bookmarks.userId })
    .from(bookmarks)
    .where(eq(bookmarks.seriesId, seriesId))
  if (readers.length === 0) return
  // D · Notifications (docs/17 §D): the in-app row is a send like any other, so it obeys the
  // reader's `new_chapter × in_app` preference. Rows are sparse — a missing one means "on".
  const ids = readers.map((r) => r.userId)
  const prefs = await tx
    .select({
      userId: notificationPrefs.userId,
      kind: notificationPrefs.kind,
      channel: notificationPrefs.channel,
      enabled: notificationPrefs.enabled,
    })
    .from(notificationPrefs)
    .where(inArray(notificationPrefs.userId, ids))
  const recipients = ids.filter((id) => prefAllows(prefs, id, 'new_chapter', 'in_app'))
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
