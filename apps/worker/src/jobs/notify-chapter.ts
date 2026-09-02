import type { Db } from '@palscans/db'
import { chapters, series } from '@palscans/db'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import {
  type ChapterFanoutSummary,
  fanoutNewChapter,
  type NotificationSettings,
} from '../../../web/lib/notifications/index.js'
import { log } from '../lib/log.js'
import type { WorkerSite } from './notify-site.js'

/**
 * `chapter.published` → push and Discord (docs/17 §D).
 *
 * This is a **sweep**, not a hook: it looks for chapters that went live recently and asks the
 * fan-out to handle each. `fanoutNewChapter` is idempotent on a `notification_deliveries`
 * dedupe key, so re-running is free — which means the publisher (`publish.ts`, owned by the
 * pipeline) needs no edit, a lost queue job costs nothing, and two workers cannot double-send.
 */
export const RECENT_WINDOW_MS = 2 * 60 * 60_000

export interface ChapterSweepDeps {
  settings: NotificationSettings
  site: WorkerSite
  now?: Date
  limit?: number
}

export const recentlyPublished = async (db: Db, since: Date, limit: number): Promise<number[]> => {
  const rows = await db
    .select({ id: chapters.id })
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(
      and(
        eq(chapters.state, 'published'),
        isNull(chapters.deletedAt),
        isNull(series.deletedAt),
        gt(chapters.publishedAt, since),
      ),
    )
    .orderBy(desc(chapters.publishedAt))
    .limit(limit)
  return rows.map((r) => r.id)
}

export const sweepNewChapters = async (
  db: Db,
  deps: ChapterSweepDeps,
): Promise<ChapterFanoutSummary[]> => {
  const now = deps.now ?? new Date()
  const ids = await recentlyPublished(
    db,
    new Date(now.getTime() - RECENT_WINDOW_MS),
    deps.limit ?? 50,
  )
  const out: ChapterFanoutSummary[] = []
  for (const id of ids) {
    try {
      out.push(
        await fanoutNewChapter(db, id, {
          settings: deps.settings,
          site: {
            siteUrl: deps.site.siteUrl,
            siteName: deps.site.siteName,
            cdnUrl: deps.site.cdnUrl,
          },
          now,
        }),
      )
    } catch (err) {
      log.error(`notify.new_chapter ${id} failed`, err)
    }
  }
  return out
}

/** One chapter, on demand — the `notify.new_chapter` queue job. */
export const notifyOneChapter = async (
  db: Db,
  chapterId: number,
  deps: ChapterSweepDeps,
): Promise<ChapterFanoutSummary> =>
  fanoutNewChapter(db, chapterId, {
    settings: deps.settings,
    site: { siteUrl: deps.site.siteUrl, siteName: deps.site.siteName, cdnUrl: deps.site.cdnUrl },
    now: deps.now,
  })
