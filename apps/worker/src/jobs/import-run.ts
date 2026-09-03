import {
  chapterRedirects,
  type LegacyChapter,
  type LegacyComment,
  type LegacyPost,
  type LegacySource,
  type LegacyTerm,
  type LegacyUser,
  legacyRedirects,
  mapBookmark,
  mapChapter,
  mapComment,
  mapSeries,
  mapTerm,
  mapUser,
} from '@palscans/core/import'
import type { Queue } from '@palscans/core/queue'
import type { Storage } from '@palscans/core/storage'
import {
  type Db,
  type ImportCounts,
  type ImportCursor,
  type ImportPhase,
  type ImportStatus,
  series,
} from '@palscans/db'
import { eq } from 'drizzle-orm'
import { log } from '../lib/log.js'
import { revalidateWeb } from '../lib/revalidate.js'
import { writeChapter } from './import/chapters.js'
import { digestOf, loadMappings, rememberMapping } from './import/map-store.js'
import {
  addError,
  bump,
  checkpoint,
  claimRun,
  loadRun,
  PHASE_ORDER,
  type RunRow,
  stopRequested,
} from './import/state.js'
import {
  ensureGenre,
  ensurePerson,
  refreshSeriesRecency,
  writeBookmark,
  writeComment,
  writeRedirects,
  writeSeries,
  writeUser,
} from './import/writers.js'

/**
 * `import.run` (docs/09, docs/17 §E): walk the legacy site once, in phases, writing a batch
 * at a time.
 *
 * Two properties matter more than speed here. It is **resumable**: every batch commits its
 * rows and its cursor in one transaction, so a worker that dies mid-import restarts on the
 * next batch rather than at the beginning. And it is **idempotent**: every legacy row is
 * keyed through `import_map`, so a second run updates what it wrote before instead of
 * duplicating it — which is what makes a trial import followed by a real one safe.
 *
 * Sources must yield rows in ascending primary-key order. That is what lets a cold resume
 * fast-forward on a cursor instead of holding every id it has already seen.
 */

export interface ImportRunDeps {
  db: Db
  storage: Storage
  queue: Queue
  /** Opened by the caller so the runner never has to know about DSNs or dump files. */
  source: LegacySource
  batchSize: number
  skipImages: boolean
  now?: () => Date
}

/** Keeps one source iterator warm across batches; a cold start fast-forwards on the cursor. */
class Cursored<T> {
  private iterator: AsyncIterator<T> | null = null
  private position = 0

  constructor(
    private readonly open: () => AsyncIterable<T>,
    private readonly idOf: (value: T) => number,
  ) {}

  /** The next row after `after`, or null at the end of the table. */
  async next(after: number): Promise<T | null> {
    if (this.iterator === null) {
      this.iterator = this.open()[Symbol.asyncIterator]()
      this.position = 0
    }
    for (;;) {
      const step = await this.iterator.next()
      if (step.done) return null
      const id = this.idOf(step.value)
      // Fast-forward past a resumed cursor. Only reachable on the first read of a cold start,
      // because after that `position` is already beyond it.
      if (id <= after && this.position <= after) continue
      this.position = id
      return step.value
    }
  }

  reset(): void {
    this.iterator = null
    this.position = 0
  }
}

interface PhaseResult {
  cursor: ImportCursor
  counts: ImportCounts
  errors: RunRow['errors']
  /** True when the phase has no rows left and the runner should advance. */
  exhausted: boolean
}

const MAX_BATCH_ERRORS = 20

export const runImport = async (runId: number, deps: ImportRunDeps): Promise<ImportStatus> => {
  const { db } = deps
  const clock = deps.now ?? (() => new Date())
  if (!(await claimRun(db, runId, clock()))) {
    log.warn('import.run not claimable', { runId })
    const current = await loadRun(db, runId)
    return current?.status ?? 'failed'
  }

  let run = await loadRun(db, runId)
  if (!run) return 'failed'
  log.info('import.run started', { runId, source: run.source, phase: run.phase })

  const streams = {
    terms: new Cursored<LegacyTerm>(
      () => deps.source.listTerms(),
      (t) => t.termId,
    ),
    users: new Cursored<LegacyUser>(
      () => deps.source.listUsers(),
      (u) => u.id,
    ),
    series: new Cursored<LegacyPost>(
      () => deps.source.listSeries(),
      (p) => p.id,
    ),
    seriesForChapters: new Cursored<LegacyPost>(
      () => deps.source.listSeries(),
      (p) => p.id,
    ),
    seriesForRedirects: new Cursored<LegacyPost>(
      () => deps.source.listSeries(),
      (p) => p.id,
    ),
    bookmarks: new Cursored<LegacyPost>(
      () => deps.source.listBookmarks(),
      (p) => p.id,
    ),
    comments: new Cursored<LegacyComment>(
      () => deps.source.listComments(),
      (c) => c.id,
    ),
  }
  /** Chapters are walked series by series, so this stream is rebuilt whenever the series moves on. */
  let chapterStream: Cursored<LegacyChapter> | null = null
  let chapterStreamFor = -1

  const finish = async (status: ImportStatus): Promise<ImportStatus> => {
    const now = clock()
    await checkpoint(db, runId, { status, finished: status !== 'paused' }, now)
    log.info('import.run stopped', { runId, status })
    if (status === 'done') await revalidateWeb(['catalog'])
    return status
  }

  for (;;) {
    const stop = await stopRequested(db, runId)
    if (stop === 'cancel') return finish('cancelled')
    if (stop === 'pause') return finish('paused')

    const phase = run.phase
    if (phase === 'done') return finish('done')

    let result: PhaseResult
    try {
      result = await runBatch(phase, run, deps, {
        streams,
        chapterStream: () => chapterStream,
        setChapterStream: (s, forId) => {
          chapterStream = s
          chapterStreamFor = forId
        },
        chapterStreamFor: () => chapterStreamFor,
        now: clock,
      })
    } catch (err) {
      log.error('import.run batch failed', err)
      const now = clock()
      await checkpoint(
        db,
        runId,
        { errors: addError(run.errors, phase, err, now.toISOString()), status: 'failed' },
        now,
      )
      return 'failed'
    }

    const now = clock()
    const nextPhase = result.exhausted
      ? (PHASE_ORDER[PHASE_ORDER.indexOf(phase) + 1] ?? 'done')
      : phase
    await checkpoint(
      db,
      runId,
      {
        phase: nextPhase,
        cursor: result.exhausted ? {} : result.cursor,
        counts: result.counts,
        errors: result.errors,
      },
      now,
    )
    if (result.exhausted) log.info('import.run phase complete', { runId, phase })

    const reloaded = await loadRun(db, runId)
    if (!reloaded) return 'failed'
    run = reloaded
  }
}

interface BatchContext {
  streams: {
    terms: Cursored<LegacyTerm>
    users: Cursored<LegacyUser>
    series: Cursored<LegacyPost>
    seriesForChapters: Cursored<LegacyPost>
    seriesForRedirects: Cursored<LegacyPost>
    bookmarks: Cursored<LegacyPost>
    comments: Cursored<LegacyComment>
  }
  chapterStream: () => Cursored<LegacyChapter> | null
  setChapterStream: (stream: Cursored<LegacyChapter> | null, forId: number) => void
  chapterStreamFor: () => number
  now: () => Date
}

const runBatch = async (
  phase: ImportPhase,
  run: RunRow,
  deps: ImportRunDeps,
  ctx: BatchContext,
): Promise<PhaseResult> => {
  switch (phase) {
    case 'terms':
      return termsBatch(run, deps, ctx)
    case 'users':
      return usersBatch(run, deps, ctx)
    case 'series':
      return seriesBatch(run, deps, ctx)
    case 'chapters':
      return chaptersBatch(run, deps, ctx)
    case 'bookmarks':
      return bookmarksBatch(run, deps, ctx)
    case 'comments':
      return commentsBatch(run, deps, ctx)
    case 'redirects':
      return redirectsBatch(run, deps, ctx)
    default:
      return { cursor: run.cursor, counts: run.counts, errors: run.errors, exhausted: true }
  }
}

/** Read up to `size` rows from a stream, resuming after `after`. */
const take = async <T>(stream: Cursored<T>, after: number, size: number): Promise<T[]> => {
  const out: T[] = []
  for (let i = 0; i < size; i++) {
    const row = await stream.next(after)
    if (row === null) break
    out.push(row)
  }
  return out
}

const termsBatch = async (
  run: RunRow,
  deps: ImportRunDeps,
  ctx: BatchContext,
): Promise<PhaseResult> => {
  const after = run.cursor.termId ?? 0
  const batch = await take(ctx.streams.terms, after, deps.batchSize)
  if (batch.length === 0)
    return { cursor: run.cursor, counts: run.counts, errors: run.errors, exhausted: true }

  const knownGenres = await loadMappings(
    deps.db,
    'genre',
    batch.map((t) => t.termId),
  )
  const knownPeople = await loadMappings(
    deps.db,
    'person',
    batch.map((t) => t.termId),
  )
  let counts = run.counts
  let errors = run.errors
  const now = ctx.now()
  await deps.db.transaction(async (tx) => {
    for (const term of batch) {
      const mapped = mapTerm(term)
      if (!mapped) {
        counts = bump(counts, 'skipped')
        continue
      }
      try {
        const digest = digestOf(mapped)
        const isPerson = mapped.role === 'author' || mapped.role === 'artist'
        const seen = (isPerson ? knownPeople : knownGenres).get(term.termId)
        if (seen && seen.digest === digest) {
          counts = bump(counts, 'skipped')
          continue
        }
        if (isPerson) {
          const id = await ensurePerson(tx as Db, mapped)
          if (id !== null) await rememberMapping(tx as Db, 'person', term.termId, id, digest, now)
        } else {
          const id = await ensureGenre(tx as Db, mapped)
          if (id === null) {
            counts = bump(counts, 'skipped')
            continue
          }
          await rememberMapping(tx as Db, 'genre', term.termId, id, digest, now)
        }
        counts = bump(counts, 'terms')
      } catch (err) {
        errors = addError(errors, `term ${term.slug}`, err, now.toISOString())
      }
    }
  })
  const last = batch[batch.length - 1]
  return {
    cursor: { ...run.cursor, termId: last ? last.termId : after },
    counts,
    errors,
    exhausted: false,
  }
}

const usersBatch = async (
  run: RunRow,
  deps: ImportRunDeps,
  ctx: BatchContext,
): Promise<PhaseResult> => {
  const after = run.cursor.userId ?? 0
  const batch = await take(ctx.streams.users, after, deps.batchSize)
  if (batch.length === 0)
    return { cursor: run.cursor, counts: run.counts, errors: run.errors, exhausted: true }

  const known = await loadMappings(
    deps.db,
    'user',
    batch.map((u) => u.id),
  )
  let counts = run.counts
  let errors = run.errors
  const now = ctx.now()
  await deps.db.transaction(async (tx) => {
    for (const legacy of batch) {
      const mapped = mapUser(legacy)
      const digest = digestOf(mapped)
      const seen = known.get(legacy.id)
      if (seen && seen.digest === digest) {
        counts = bump(counts, 'skipped')
        continue
      }
      try {
        const id = await writeUser(tx as Db, mapped, seen?.targetId ?? null)
        await rememberMapping(tx as Db, 'user', legacy.id, id, digest, now)
        counts = bump(counts, 'users')
      } catch (err) {
        errors = addError(errors, `user ${legacy.login}`, err, now.toISOString())
      }
    }
  })
  const last = batch[batch.length - 1]
  return {
    cursor: { ...run.cursor, userId: last ? last.id : after },
    counts,
    errors,
    exhausted: false,
  }
}

const seriesBatch = async (
  run: RunRow,
  deps: ImportRunDeps,
  ctx: BatchContext,
): Promise<PhaseResult> => {
  const after = run.cursor.seriesPostId ?? 0
  // Series carry the most work per row (titles, genres, people), so they move in smaller bites.
  const size = Math.max(1, Math.min(deps.batchSize, 25))
  const batch = await take(ctx.streams.series, after, size)
  if (batch.length === 0)
    return { cursor: run.cursor, counts: run.counts, errors: run.errors, exhausted: true }

  const known = await loadMappings(
    deps.db,
    'series',
    batch.map((p) => p.id),
  )
  let counts = run.counts
  let errors = run.errors
  const now = ctx.now()
  await deps.db.transaction(async (tx) => {
    for (const post of batch) {
      const mapped = mapSeries(post)
      const digest = digestOf(mapped)
      const seen = known.get(post.id)
      if (seen && seen.digest === digest) {
        counts = bump(counts, 'skipped')
        continue
      }
      try {
        const id = await writeSeries(tx as Db, mapped, seen?.targetId ?? null)
        await rememberMapping(tx as Db, 'series', post.id, id, digest, now)
        counts = bump(counts, 'series')
      } catch (err) {
        errors = addError(errors, `series ${post.name || post.id}`, err, now.toISOString())
      }
    }
  })
  const last = batch[batch.length - 1]
  return {
    cursor: { ...run.cursor, seriesPostId: last ? last.id : after },
    counts,
    errors,
    exhausted: false,
  }
}

/**
 * Chapters walk two cursors: which series is open, and how far into it we are. Images make
 * this the slowest phase by far, so its batch is the one an operator actually feels — a stop
 * lands between chapters, never between a chapter's pages.
 */
const chaptersBatch = async (
  run: RunRow,
  deps: ImportRunDeps,
  ctx: BatchContext,
): Promise<PhaseResult> => {
  let seriesPostId = run.cursor.chapterSeriesPostId ?? 0
  const now = ctx.now()
  let counts = run.counts
  let errors = run.errors

  // Open the series the cursor names, pulling a new one only when it names none.
  //
  // This used to also pull a new series whenever `chapterId` was 0, which silently skipped
  // every other series: finishing a series already advances the stream and checkpoints the
  // *next* series with `chapterId: 0`, so the following batch asked for another one and the
  // series just checkpointed was never opened. The run still reported `done`, with roughly
  // half the migrated catalogue holding no chapters at all.
  if (ctx.chapterStreamFor() !== seriesPostId || ctx.chapterStream() === null) {
    const next =
      seriesPostId === 0
        ? await ctx.streams.seriesForChapters.next(seriesPostId)
        : { id: seriesPostId, name: '' as string }
    if (next === null) return { cursor: run.cursor, counts, errors, exhausted: true }
    seriesPostId = next.id
    const stream = new Cursored<LegacyChapter>(
      () => deps.source.listChapters(seriesPostId),
      (c) => c.chapterId,
    )
    ctx.setChapterStream(stream, seriesPostId)
  }

  const stream = ctx.chapterStream()
  if (!stream) return { cursor: run.cursor, counts, errors, exhausted: true }

  const after = run.cursor.chapterId ?? 0
  // Image work dominates; a handful of chapters per batch keeps checkpoints frequent.
  const size = deps.skipImages ? Math.max(1, Math.min(deps.batchSize, 50)) : 4
  const batch = await take(stream, after, size)

  if (batch.length === 0) {
    // This series is finished; move to the next one on the next batch.
    ctx.setChapterStream(null, -1)
    const nextSeries = await ctx.streams.seriesForChapters.next(seriesPostId)
    if (nextSeries === null) return { cursor: run.cursor, counts, errors, exhausted: true }
    return {
      cursor: { ...run.cursor, chapterSeriesPostId: nextSeries.id, chapterId: 0 },
      counts,
      errors,
      exhausted: false,
    }
  }

  const seriesRef = await loadMappings(deps.db, 'series', [seriesPostId])
  const localSeriesId = seriesRef.get(seriesPostId)?.targetId
  if (localSeriesId === undefined) {
    // The series phase skipped or failed this post; its chapters have nowhere to go.
    errors = addError(
      errors,
      `chapters of post ${seriesPostId}`,
      'series was not imported',
      now.toISOString(),
    )
    ctx.setChapterStream(null, -1)
    const nextSeries = await ctx.streams.seriesForChapters.next(seriesPostId)
    return {
      cursor: nextSeries
        ? { ...run.cursor, chapterSeriesPostId: nextSeries.id, chapterId: 0 }
        : run.cursor,
      counts: bump(counts, 'skipped', batch.length),
      errors,
      exhausted: nextSeries === null,
    }
  }

  const known = await loadMappings(
    deps.db,
    'chapter',
    batch.map((c) => c.chapterId),
  )
  const mappedForRedirects: ReturnType<typeof mapChapter>[] = []

  // Page uploads talk to object storage, which must not hold a database transaction open —
  // so each chapter commits on its own and the cursor advances with it.
  for (const legacy of batch) {
    const mapped = mapChapter(legacy)
    const digest = digestOf(mapped)
    const seen = known.get(legacy.chapterId)
    if (seen && seen.digest === digest) {
      counts = bump(counts, 'skipped')
      continue
    }
    if (mapped.number === null) {
      errors = addError(
        errors,
        `chapter "${mapped.rawName}"`,
        'no parsable number',
        now.toISOString(),
      )
      counts = bump(counts, 'skipped')
      continue
    }
    try {
      const result = await writeChapter(deps.db, mapped, localSeriesId, seen?.targetId ?? null, {
        storage: deps.storage,
        queue: deps.queue,
        source: deps.source,
        skipImages: deps.skipImages,
        now,
      })
      await rememberMapping(deps.db, 'chapter', legacy.chapterId, result.chapterId, digest, now)
      counts = bump(bump(counts, 'chapters'), 'pages', result.pages)
      for (const message of result.errors.slice(0, MAX_BATCH_ERRORS))
        errors = addError(errors, `chapter ${mapped.number}`, message, now.toISOString())
      mappedForRedirects.push(mapped)
    } catch (err) {
      errors = addError(errors, `chapter "${mapped.rawName}"`, err, now.toISOString())
    }
  }

  if (mappedForRedirects.length > 0) {
    const slug = await seriesSlugOf(deps.db, localSeriesId)
    if (slug)
      counts = bump(
        counts,
        'redirects',
        await writeRedirects(deps.db, chapterRedirects(slug, mappedForRedirects)),
      )
  }
  await refreshSeriesRecency(deps.db, localSeriesId)

  const last = batch[batch.length - 1]
  return {
    cursor: {
      ...run.cursor,
      chapterSeriesPostId: seriesPostId,
      chapterId: last ? last.chapterId : after,
    },
    counts,
    errors,
    exhausted: false,
  }
}

const seriesSlugOf = async (db: Db, id: number): Promise<string | null> => {
  const [row] = await db
    .select({ slug: series.slug })
    .from(series)
    .where(eq(series.id, id))
    .limit(1)
  return row?.slug ?? null
}

const bookmarksBatch = async (
  run: RunRow,
  deps: ImportRunDeps,
  ctx: BatchContext,
): Promise<PhaseResult> => {
  const after = run.cursor.bookmarkPostId ?? 0
  const batch = await take(ctx.streams.bookmarks, after, deps.batchSize)
  if (batch.length === 0)
    return { cursor: run.cursor, counts: run.counts, errors: run.errors, exhausted: true }

  const mapped = batch.map(mapBookmark)
  const userIds = await loadMappings(
    deps.db,
    'user',
    mapped.map((b) => b.legacyUserId),
  )
  const seriesIds = await loadMappings(
    deps.db,
    'series',
    mapped.flatMap((b) => (b.seriesLegacyId === null ? [] : [b.seriesLegacyId])),
  )
  const known = await loadMappings(
    deps.db,
    'bookmark',
    mapped.map((b) => b.legacyId),
  )
  let counts = run.counts
  const errors = run.errors
  const now = ctx.now()
  await deps.db.transaction(async (tx) => {
    for (const b of mapped) {
      const userId = userIds.get(b.legacyUserId)?.targetId
      const seriesId =
        b.seriesLegacyId === null ? undefined : seriesIds.get(b.seriesLegacyId)?.targetId
      if (userId === undefined || seriesId === undefined) {
        counts = bump(counts, 'skipped')
        continue
      }
      const digest = digestOf(b)
      if (known.get(b.legacyId)?.digest === digest) {
        counts = bump(counts, 'skipped')
        continue
      }
      await writeBookmark(tx as Db, b, userId, seriesId)
      await rememberMapping(tx as Db, 'bookmark', b.legacyId, seriesId, digest, now)
      counts = bump(counts, 'bookmarks')
    }
  })
  const last = batch[batch.length - 1]
  return {
    cursor: { ...run.cursor, bookmarkPostId: last ? last.id : after },
    counts,
    errors,
    exhausted: false,
  }
}

/**
 * Comments need an account, and the legacy table is full of guest comments that never had
 * one. Those are counted as skipped rather than attached to an invented user — a fabricated
 * account is worse than a missing comment, and the count makes the loss visible.
 */
const commentsBatch = async (
  run: RunRow,
  deps: ImportRunDeps,
  ctx: BatchContext,
): Promise<PhaseResult> => {
  const after = run.cursor.commentId ?? 0
  const batch = await take(ctx.streams.comments, after, deps.batchSize)
  if (batch.length === 0)
    return { cursor: run.cursor, counts: run.counts, errors: run.errors, exhausted: true }

  const mapped = batch.map(mapComment)
  const userIds = await loadMappings(
    deps.db,
    'user',
    mapped.flatMap((c) => (c.legacyUserId === null ? [] : [c.legacyUserId])),
  )
  const seriesIds = await loadMappings(
    deps.db,
    'series',
    mapped.map((c) => c.legacyPostId),
  )
  const parentIds = await loadMappings(
    deps.db,
    'comment',
    mapped.flatMap((c) => (c.legacyParentId === null ? [] : [c.legacyParentId])),
  )
  const known = await loadMappings(
    deps.db,
    'comment',
    mapped.map((c) => c.legacyId),
  )
  let counts = run.counts
  let errors = run.errors
  const now = ctx.now()
  await deps.db.transaction(async (tx) => {
    for (const c of mapped) {
      const userId = c.legacyUserId === null ? undefined : userIds.get(c.legacyUserId)?.targetId
      const seriesId = seriesIds.get(c.legacyPostId)?.targetId
      if (userId === undefined || seriesId === undefined) {
        counts = bump(counts, 'skipped')
        continue
      }
      const digest = digestOf(c)
      const seen = known.get(c.legacyId)
      if (seen && seen.digest === digest) {
        counts = bump(counts, 'skipped')
        continue
      }
      try {
        const id = await writeComment(
          tx as Db,
          c,
          {
            userId,
            seriesId,
            parentId:
              c.legacyParentId === null
                ? null
                : (parentIds.get(c.legacyParentId)?.targetId ?? null),
          },
          seen?.targetId ?? null,
        )
        await rememberMapping(tx as Db, 'comment', c.legacyId, id, digest, now)
        counts = bump(counts, 'comments')
      } catch (err) {
        errors = addError(errors, `comment ${c.legacyId}`, err, now.toISOString())
      }
    }
  })
  const last = batch[batch.length - 1]
  return {
    cursor: { ...run.cursor, commentId: last ? last.id : after },
    counts,
    errors,
    exhausted: false,
  }
}

/** Series and genre redirects. Chapter redirects were written as their chapters landed. */
const redirectsBatch = async (
  run: RunRow,
  deps: ImportRunDeps,
  ctx: BatchContext,
): Promise<PhaseResult> => {
  const batch = await take(ctx.streams.seriesForRedirects, run.cursor.seriesPostId ?? 0, 200)
  if (batch.length === 0)
    return { cursor: run.cursor, counts: run.counts, errors: run.errors, exhausted: true }
  const rows = legacyRedirects(batch.map(mapSeries))
  const written = await writeRedirects(deps.db, rows)
  const last = batch[batch.length - 1]
  return {
    cursor: { ...run.cursor, seriesPostId: last ? last.id : (run.cursor.seriesPostId ?? 0) },
    counts: bump(run.counts, 'redirects', written),
    errors: run.errors,
    exhausted: false,
  }
}
