import {
  GalleryError,
  type ManifestChapter,
  manifestChapterUrl,
  manifestFingerprint,
  resolveManifest,
} from '@palscans/core/gallery'
import type { Queue } from '@palscans/core/queue'
import {
  type ChapterProcessing,
  chapters,
  creditChapterGroupByName,
  type Db,
  manifestSources,
} from '@palscans/db'
import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { log } from '../lib/log.js'

/**
 * `manifest.sync` — re-read the manifests a series follows and import what is new.
 *
 * The import panel takes a snapshot of a manifest. This is the other half: the file is alive,
 * the group maintaining it adds a chapter the evening it releases, and without this the
 * catalogue is frozen at whenever somebody last pasted the link. Cubari's whole model is that
 * the file is the source of truth and the site follows it; this is that, for our own rows.
 *
 * What it will not do is anything destructive. A chapter that disappeared from the manifest is
 * left alone, a chapter whose number already exists is skipped rather than replaced, and the
 * group's name is credited but nothing else about an existing chapter is touched. The sync
 * runs unattended against a file somebody else edits — the blast radius of a bad edit over
 * there has to stop at "a chapter that should not be here", which an operator can delete, and
 * never reach "the chapter that was here is gone".
 */

const envSchema = z.object({
  /**
   * How long a source may go unchecked.
   *
   * Fifteen minutes is the compromise this feature lives or dies by: the operator's mental
   * model is "the gist updates, the site updates", and an hour of lag reads as broken, while
   * polling every minute spends a request per source per minute on files that change weekly.
   */
  WORKER_MANIFEST_SYNC_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  /**
   * Sources one pass checks, so a hundred followed series do not all fetch in one tick.
   *
   * Fifteen rather than five: a restart makes every source due at once, and at five per
   * fifteen minutes a site following twenty series takes an hour to catch up on the
   * releases that landed while it was down. The fetch is a small JSON file; what actually
   * limits a pass is `MAX_NEW_PER_CHECK` below, which caps the chapters any one source can
   * queue — so this number costs requests, not downloads.
   */
  WORKER_MANIFEST_SYNC_BATCH: z.coerce.number().int().positive().default(15),
})

export type ManifestSyncEnv = z.infer<typeof envSchema>

let cachedEnv: ManifestSyncEnv | undefined

/**
 * Blank is unset, as everywhere else in this repo: `WORKER_MANIFEST_SYNC_MS=` left empty in a
 * compose file must fall back to the default rather than coerce to 0, fail `.positive()` and
 * take the whole worker down at import time over a knob nobody set deliberately. That has
 * happened here once already, with `IMGCHEST_TOKEN`.
 */
export const manifestSyncEnv = (): ManifestSyncEnv => {
  cachedEnv ??= envSchema.parse(
    Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== '')),
  )
  return cachedEnv
}

/** Tests that mutate `process.env`. */
export const resetManifestSyncEnv = (): void => {
  cachedEnv = undefined
}

/**
 * New chapters one check may import.
 *
 * A first check of a long-running series would otherwise queue two hundred downloads behind
 * a single scheduler tick. The cap is not a limit on what gets imported — the next check
 * takes the next batch — it is a limit on how much one pass can commit to the image host at
 * once, and it keeps a misconfigured source from becoming a flood.
 */
export const MAX_NEW_PER_CHECK = 25

/** Seconds between queued downloads, same pacing as a hand-run manifest import. */
const STAGGER_SECONDS = 15

export interface ManifestSyncDeps {
  db: Db
  queue: Queue
  /** ImgChest API token, when the operator has one. Unset is fine — the page parser works. */
  token?: string
  /** Injected in tests; defaults to the platform fetch. */
  fetchImpl?: typeof globalThis.fetch
  /** Tests. */
  now?: Date
}

export interface ManifestSyncResult {
  sourceId: number
  /** True when the file's chapter list is byte-identical in the ways we care about. */
  unchanged: boolean
  queued: number
  /** Chapters in the file that already exist here, or that this pass deferred to the next. */
  skipped: number
  error: string | null
}

/**
 * The sources due for a check: active, and either never checked or checked longer ago than
 * the interval. Oldest first, so a backlog drains in a fair order rather than starving the
 * source that happens to sort last.
 */
export const dueManifestSources = async (
  db: Db,
  opts: { intervalMs: number; limit?: number; now?: Date },
): Promise<number[]> => {
  const now = opts.now ?? new Date()
  const rows = await db
    .select({ id: manifestSources.id })
    .from(manifestSources)
    .where(
      and(
        eq(manifestSources.active, true),
        or(
          isNull(manifestSources.lastCheckedAt),
          lt(manifestSources.lastCheckedAt, new Date(now.getTime() - opts.intervalMs)),
        ),
      ),
    )
    /**
     * `nulls first` written out, because ascending order in Postgres puts them last — and a
     * never-checked source is the one most in need of a check. Spelled as raw SQL rather
     * than `asc(sql\`…\`)`, which renders the keywords the wrong way round and is a syntax
     * error.
     */
    .orderBy(sql`${manifestSources.lastCheckedAt} asc nulls first`, asc(manifestSources.id))
    .limit(opts.limit ?? 5)
  return rows.map((r) => r.id)
}

/** The number as the unique index sees it, so 7.10 and 7.1 are one chapter. */
const numberKey = (n: number) => n.toFixed(3)

/**
 * Check one source and import what appeared since the last check.
 *
 * Never throws: a source is one of many and a manifest that has been deleted, moved behind
 * Cloudflare or edited into invalid JSON must not take down the pass — still less the worker.
 * The reason is written to the row, where the panel shows it.
 */
export const syncManifestSource = async (
  sourceId: number,
  deps: ManifestSyncDeps,
): Promise<ManifestSyncResult> => {
  const { db, queue } = deps
  const now = deps.now ?? new Date()
  const base: ManifestSyncResult = {
    sourceId,
    unchanged: false,
    queued: 0,
    skipped: 0,
    error: null,
  }
  const [source] = await db
    .select()
    .from(manifestSources)
    .where(eq(manifestSources.id, sourceId))
    .limit(1)
  if (!source) return base

  const finish = async (patch: Partial<typeof manifestSources.$inferInsert>) => {
    await db
      .update(manifestSources)
      .set({ lastCheckedAt: now, updatedAt: now, ...patch })
      .where(eq(manifestSources.id, sourceId))
  }

  let chaptersInFile: ManifestChapter[]
  let fingerprint: string
  try {
    const { manifest } = await resolveManifest(source.url, {
      token: deps.token,
      group: source.groupName,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    })
    chaptersInFile = manifest.chapters
    fingerprint = manifestFingerprint(manifest)
  } catch (error) {
    const message =
      error instanceof GalleryError
        ? `${error.code}: ${error.message}`
        : String(error instanceof Error ? error.message : error)
    log.warn('manifest.sync could not read a source', { sourceId, url: source.url, message })
    await finish({ lastError: message.slice(0, 500) })
    return { ...base, error: message }
  }

  /**
   * An unchanged file stops here.
   *
   * This is the common case by a wide margin — most checks of most sources find nothing — and
   * stopping at the fingerprint means the steady state of this feature is one HTTP GET per
   * source per interval and no database work beyond the timestamp.
   */
  if (fingerprint === source.fingerprint) {
    await finish({ lastError: null })
    return { ...base, unchanged: true }
  }

  // What we already have for this series in this language. Deleted chapters count as present:
  // an operator who removed a chapter does not want the sync putting it back next hour.
  const existing = await db
    .select({ number: chapters.number })
    .from(chapters)
    .where(and(eq(chapters.seriesId, source.seriesId), eq(chapters.language, source.language)))
  const have = new Set(existing.map((c) => numberKey(c.number)))

  const fresh = chaptersInFile.filter((c) => !have.has(numberKey(c.number)))
  const taking = fresh.slice(0, MAX_NEW_PER_CHECK)
  const deferred = fresh.length - taking.length

  if (taking.length === 0) {
    // Nothing new, but the file did change — a title edited, a chapter repointed. Record the
    // new fingerprint so the next pass can stop at it again.
    await finish({ fingerprint, lastChangedAt: now, lastError: null })
    return { ...base, skipped: chaptersInFile.length - fresh.length }
  }

  const queued: Array<{ chapterId: number; attempt: number; group: string | null }> = []
  await db.transaction(async (tx) => {
    for (const chapter of taking) {
      const links = chapter.source.kind === 'direct' ? chapter.source.links : undefined
      const processing: ChapterProcessing = {
        sources: [],
        progress: { done: 0, total: links?.length ?? 0 },
        errors: {},
        attempt: 1,
        mode: 'all',
        fetch: {
          url: manifestChapterUrl(chapter),
          provider: chapter.source.kind === 'direct' ? 'direct' : chapter.source.provider,
          title: chapter.title,
          mode: source.store,
          ...(links ? { links } : {}),
        },
        after: {
          isPremium: source.isPremium,
          // `publish` means the chapter goes live as soon as its pages are in, which is the
          // whole point of an unattended sync for most operators. `ready` leaves it for a
          // human, and is the default precisely because this decision is somebody else's
          // file deciding what appears on this site.
          publishedAt: source.publishMode === 'publish' ? now.toISOString() : null,
        },
        startedAt: null,
        finishedAt: null,
      }
      const [created] = await tx
        .insert(chapters)
        .values({
          seriesId: source.seriesId,
          number: chapter.number,
          language: source.language,
          title: chapter.title,
          volume: chapter.volume,
          state: 'processing',
          isPremium: source.isPremium,
          processing,
          // No `uploadedBy`: nobody uploaded it. The source row records who set the sync up.
          createdAt: now,
          updatedAt: now,
        })
        /**
         * A number that appeared between the read above and this insert is left to the
         * existing row — the other writer is a human doing it by hand, and the sync is never
         * the one that wins a race against an operator.
         */
        .onConflictDoNothing({
          target: [chapters.seriesId, chapters.number, chapters.language],
        })
        .returning({ id: chapters.id })
      if (!created) continue
      queued.push({ chapterId: created.id, attempt: 1, group: chapter.group })
    }
  })

  // After the commit, like the hand-run import: a download job that beats its own chapter row
  // fails on a chapter that does not exist yet.
  for (const [i, job] of queued.entries()) {
    try {
      await queue.add(
        'chapter.fetch',
        { chapterId: job.chapterId },
        {
          jobId: `chapter.fetch:${job.chapterId}:${job.attempt}`,
          attempts: 2,
          ...(i > 0 ? { delayMs: i * STAGGER_SECONDS * 1000 } : {}),
        },
      )
    } catch (error) {
      // The row is `processing` with a `fetch` document, which the scheduler's stale sweep
      // picks up — so a failed enqueue costs a delay, not a lost chapter.
      log.warn('manifest.sync could not enqueue a fetch', {
        chapterId: job.chapterId,
        error: String(error),
      })
    }
  }

  // Credit the group the file names, grouped so one name is one lookup. Outside the
  // transaction because it may create a group row, and a new name must not hold a lock on
  // every chapter this pass inserted.
  const byGroup = new Map<string, number[]>()
  for (const job of queued) {
    const name = job.group?.trim()
    if (!name) continue
    byGroup.set(name, [...(byGroup.get(name) ?? []), job.chapterId])
  }
  for (const [name, ids] of byGroup) {
    try {
      await creditChapterGroupByName(ids, name, db)
    } catch (error) {
      log.warn('manifest.sync could not credit a group', { name, error: String(error) })
    }
  }

  await finish({
    /**
     * Only once the file is fully taken in.
     *
     * With chapters deferred by the cap, recording the fingerprint would make the next pass
     * recognise the file as unchanged and stop before reaching them — a first check of a
     * 200-chapter manifest would import 25 and then sit there calling itself up to date.
     * Leaving it unset costs one chapter-table query per pass until the backlog is drained.
     */
    ...(deferred > 0 ? {} : { fingerprint }),
    lastChangedAt: now,
    lastError: null,
    imported: source.imported + queued.length,
  })
  log.info('manifest.sync imported chapters', {
    sourceId,
    seriesId: source.seriesId,
    queued: queued.length,
    deferred,
  })
  return {
    ...base,
    queued: queued.length,
    skipped: chaptersInFile.length - fresh.length + deferred,
  }
}
