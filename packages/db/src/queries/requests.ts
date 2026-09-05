import { and, desc, eq, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm'
import type { Db } from '../client.js'
import {
  REQUEST_STATUSES,
  type RequestStatus,
  series,
  seriesRequests,
  seriesRequestVotes,
} from '../schema/index.js'
import { escapeLike } from './_shared.js'

/**
 * The series request board (migration 9024). Everything the public board, the modal and the
 * admin queue need to read or change a request lives here, so the dedupe rule and the
 * one-vote rule are written once — and tested once, against a real Postgres — instead of
 * being re-derived in four route handlers.
 *
 * The catalogue half of "search before you post" is deliberately **not** here: matching a
 * typed title against series the site already has is `searchSeries` in ./search.ts, and
 * calling it is the whole implementation. There is one series search in this codebase.
 */

export const MAX_ALT_TITLES = 10
export const MAX_TITLE = 200
export const MAX_NOTE = 1000
export const BOARD_PAGE_SIZE = 25

/** Trigram floor for "is this the same title" — below `searchSeries`'s 0.25 would be noise. */
export const REQUEST_MATCH_THRESHOLD = 0.3
/**
 * Above this, two titles are the same thing said differently and the submission is refused
 * with a pointer at the row that exists. Below it the reader is only *shown* the near
 * matches and decides for themselves.
 */
export const REQUEST_DUPLICATE_THRESHOLD = 0.72

/**
 * The JavaScript twin of the `title_key` generated column. Both must agree, which is why
 * the expression is written once here and once in the migration and nowhere else: the
 * database owns the value, this is only how the app predicts a collision before it happens.
 */
export const requestTitleKey = (title: string): string =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, '')

export type RequestSort = 'votes' | 'new'
export type RequestFilter = RequestStatus | 'all' | 'resolved'

export const isRequestStatus = (value: unknown): value is RequestStatus =>
  typeof value === 'string' && (REQUEST_STATUSES as readonly string[]).includes(value)

export interface RequestRow {
  id: number
  title: string
  altTitles: string[]
  link: string | null
  type: string | null
  note: string | null
  status: RequestStatus
  declineReason: string | null
  voteCount: number
  createdAt: Date
  resolvedAt: Date | null
  /** The series that fulfils it, when there is one — this is what closes the loop. */
  seriesId: number | null
  seriesSlug: string | null
  seriesTitle: string | null
  /** Signed-in requester, for the admin queue only. Never sent to the public board. */
  userId: number | null
}

const rowColumns = {
  id: seriesRequests.id,
  title: seriesRequests.title,
  altTitles: seriesRequests.altTitles,
  link: seriesRequests.link,
  type: seriesRequests.type,
  note: seriesRequests.note,
  status: seriesRequests.status,
  declineReason: seriesRequests.declineReason,
  voteCount: seriesRequests.voteCount,
  createdAt: seriesRequests.createdAt,
  resolvedAt: seriesRequests.resolvedAt,
  seriesId: seriesRequests.seriesId,
  seriesSlug: series.slug,
  seriesTitle: series.title,
  userId: seriesRequests.userId,
} as const

const filterWhere = (filter: RequestFilter): SQL | undefined => {
  if (filter === 'all') return undefined
  if (filter === 'resolved')
    return inArray(seriesRequests.status, ['added', 'exists', 'declined'] as RequestStatus[])
  return eq(seriesRequests.status, filter)
}

export interface ListRequestsOptions {
  filter?: RequestFilter
  sort?: RequestSort
  page?: number
  pageSize?: number
  /** Free-text filter for the admin queue (title and alternative titles). */
  q?: string
  /** Admin only: show rows that were merged away. The board never does. */
  includeMerged?: boolean
}

export interface RequestPage {
  items: RequestRow[]
  total: number
  page: number
  pages: number
}

/**
 * A page of the board. "Most wanted" is `vote_count DESC` off the denormalised counter and
 * the partial index behind it, never a count over the vote table.
 */
export const listRequests = async (
  db: Db,
  opts: ListRequestsOptions = {},
): Promise<RequestPage> => {
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? BOARD_PAGE_SIZE))
  const page = Math.max(1, Math.floor(opts.page ?? 1))
  const q = opts.q?.trim()
  const like = q ? `%${escapeLike(q)}%` : null
  const where = and(
    opts.includeMerged ? undefined : isNull(seriesRequests.mergedIntoId),
    filterWhere(opts.filter ?? 'open'),
    like
      ? or(
          sql`${seriesRequests.title} ilike ${like} escape '\\'`,
          sql`exists (select 1 from unnest(${seriesRequests.altTitles}) alt where alt ilike ${like} escape '\\')`,
        )
      : undefined,
  )
  const order =
    (opts.sort ?? 'votes') === 'new'
      ? [desc(seriesRequests.createdAt), desc(seriesRequests.id)]
      : [desc(seriesRequests.voteCount), desc(seriesRequests.createdAt), desc(seriesRequests.id)]

  const [items, [totals]] = await Promise.all([
    db
      .select(rowColumns)
      .from(seriesRequests)
      .leftJoin(series, eq(series.id, seriesRequests.seriesId))
      .where(where)
      .orderBy(...order)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(seriesRequests).where(where),
  ])
  const total = Number(totals?.n ?? 0)
  return {
    items: items as RequestRow[],
    total,
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  }
}

export const requestById = async (db: Db, id: number): Promise<RequestRow | null> => {
  const [row] = await db
    .select(rowColumns)
    .from(seriesRequests)
    .leftJoin(series, eq(series.id, seriesRequests.seriesId))
    .where(eq(seriesRequests.id, id))
    .limit(1)
  return (row as RequestRow | undefined) ?? null
}

/** How many rows are waiting in each status — the admin queue's counts, in one query. */
export const requestStatusCounts = async (db: Db): Promise<Record<RequestStatus, number>> => {
  const rows = await db
    .select({ status: seriesRequests.status, n: sql<number>`count(*)::int` })
    .from(seriesRequests)
    .where(isNull(seriesRequests.mergedIntoId))
    .groupBy(seriesRequests.status)
  const out = Object.fromEntries(REQUEST_STATUSES.map((s) => [s, 0])) as Record<
    RequestStatus,
    number
  >
  for (const r of rows) if (isRequestStatus(r.status)) out[r.status] = Number(r.n)
  return out
}

export interface RequestMatch extends RequestRow {
  /** 0…1-ish; ≥ REQUEST_DUPLICATE_THRESHOLD is "this is the same title". */
  score: number
}

/**
 * Existing requests that look like `q` — the "somebody already asked for this" half of
 * search-before-you-post. Trigram similarity plus a substring match, the same two signals
 * `searchSeries` combines for the catalogue, over `series_requests.title` (which has its own
 * `gin_trgm_ops` index) and the alternative titles a requester supplied.
 */
export const searchRequests = async (db: Db, q: string, limit = 8): Promise<RequestMatch[]> => {
  const query = q.trim().replace(/\s+/g, ' ')
  if (query.length < 2) return []
  const like = `%${escapeLike(query)}%`
  const altScore = sql<number>`coalesce((select max(greatest(similarity(alt, ${query}), case when alt ilike ${like} escape '\\' then 0.6 else 0 end)) from unnest(${seriesRequests.altTitles}) alt), 0)`
  const score = sql<number>`greatest(similarity(${seriesRequests.title}, ${query}), case when ${seriesRequests.title} ilike ${like} escape '\\' then 0.6 else 0 end, ${altScore})`
  const rows = await db
    .select({ ...rowColumns, score })
    .from(seriesRequests)
    .leftJoin(series, eq(series.id, seriesRequests.seriesId))
    .where(
      and(
        isNull(seriesRequests.mergedIntoId),
        or(
          sql`${seriesRequests.title} ilike ${like} escape '\\'`,
          sql`similarity(${seriesRequests.title}, ${query}) >= ${REQUEST_MATCH_THRESHOLD}`,
          sql`${altScore} >= ${REQUEST_MATCH_THRESHOLD}`,
        ),
      ),
    )
    .orderBy(desc(score), desc(seriesRequests.voteCount))
    .limit(Math.min(25, Math.max(1, limit)))
  return rows.map((r) => ({ ...(r as RequestRow), score: Number(r.score) }))
}

/**
 * The row a submission of `title` would collide with, if any: the exact normalised match
 * first (which the unique index would refuse anyway), then a trigram near-match strong
 * enough to call the same title. Merged rows resolve to whatever they were merged into, so
 * a reader is always pointed at the row that carries the votes.
 */
export const findDuplicateRequest = async (db: Db, title: string): Promise<RequestRow | null> => {
  const key = requestTitleKey(title)
  if (key) {
    const [exact] = await db
      .select({ id: seriesRequests.id, mergedIntoId: seriesRequests.mergedIntoId })
      .from(seriesRequests)
      .where(eq(seriesRequests.titleKey, key))
      .limit(1)
    if (exact) return requestById(db, exact.mergedIntoId ?? exact.id)
  }
  const [near] = await searchRequests(db, title, 1)
  return near && near.score >= REQUEST_DUPLICATE_THRESHOLD ? near : null
}

export interface CreateRequestInput {
  title: string
  altTitles?: readonly string[]
  link?: string | null
  type?: string | null
  note?: string | null
  userId?: number | null
  requesterKey?: Uint8Array | null
  /** Cast by the submitter as part of the same write — asking for something is wanting it. */
  voterKey?: Uint8Array | null
}

export type CreateRequestResult =
  | { ok: true; request: RequestRow }
  | { ok: false; reason: 'duplicate'; existing: RequestRow }

/**
 * File a request, or hand back the one that already exists.
 *
 * The unique index on `title_key` is the arbiter, not the lookup above it: two people
 * submitting the same title in the same second both reach the insert, one wins, and the
 * loser is told which row to upvote. The submitter's own vote goes in the same transaction —
 * a request with zero votes from the person who wanted it would be a strange thing to show.
 */
export const createRequest = async (
  db: Db,
  input: CreateRequestInput,
): Promise<CreateRequestResult> => {
  const title = input.title.trim()
  const existing = await findDuplicateRequest(db, title)
  if (existing) return { ok: false, reason: 'duplicate', existing }

  const inserted = await db
    .insert(seriesRequests)
    .values({
      title,
      altTitles: [...(input.altTitles ?? [])],
      link: input.link ?? null,
      type: (input.type ?? null) as never,
      note: input.note ?? null,
      userId: input.userId ?? null,
      requesterKey: input.requesterKey ?? null,
    })
    .onConflictDoNothing({ target: seriesRequests.titleKey })
    .returning({ id: seriesRequests.id })
  const id = inserted[0]?.id
  if (id === undefined) {
    // Lost the race on the unique index: the winner is the row to upvote.
    const winner = await findDuplicateRequest(db, title)
    if (winner) return { ok: false, reason: 'duplicate', existing: winner }
    throw new Error('series request insert conflicted but no row could be found')
  }
  if (input.voterKey)
    await db
      .insert(seriesRequestVotes)
      .values({ requestId: id, voterKey: input.voterKey, userId: input.userId ?? null })
      .onConflictDoNothing()
  const row = await requestById(db, id)
  if (!row) throw new Error('series request vanished immediately after insert')
  return { ok: true, request: row }
}

export interface VoteInput {
  requestId: number
  voterKey: Uint8Array
  userId?: number | null
}

export type VoteResult = { ok: true; voted: boolean; voteCount: number } | { ok: false }

/**
 * Cast (or withdraw) one vote. `ON CONFLICT DO NOTHING` against the primary key is the whole
 * duplicate check — a second tap, a second tab and a second app instance all end in the same
 * single row, and `vote_count` is corrected by the trigger either way.
 */
export const voteForRequest = async (db: Db, input: VoteInput): Promise<VoteResult> => {
  const [target] = await db
    .select({ id: seriesRequests.id, merged: seriesRequests.mergedIntoId })
    .from(seriesRequests)
    .where(eq(seriesRequests.id, input.requestId))
    .limit(1)
  if (!target) return { ok: false }
  // A vote on a merged row belongs to whatever it was merged into.
  const id = target.merged ?? target.id
  await db
    .insert(seriesRequestVotes)
    .values({ requestId: id, voterKey: input.voterKey, userId: input.userId ?? null })
    .onConflictDoNothing()
  return { ok: true, voted: true, voteCount: await voteCountOf(db, id) }
}

export const unvoteRequest = async (db: Db, input: VoteInput): Promise<VoteResult> => {
  const [target] = await db
    .select({ id: seriesRequests.id, merged: seriesRequests.mergedIntoId })
    .from(seriesRequests)
    .where(eq(seriesRequests.id, input.requestId))
    .limit(1)
  if (!target) return { ok: false }
  const id = target.merged ?? target.id
  await db
    .delete(seriesRequestVotes)
    .where(
      and(
        eq(seriesRequestVotes.requestId, id),
        input.userId
          ? or(
              eq(seriesRequestVotes.voterKey, input.voterKey),
              eq(seriesRequestVotes.userId, input.userId),
            )
          : eq(seriesRequestVotes.voterKey, input.voterKey),
      ),
    )
  return { ok: true, voted: false, voteCount: await voteCountOf(db, id) }
}

const voteCountOf = async (db: Db, id: number): Promise<number> => {
  const [row] = await db
    .select({ n: seriesRequests.voteCount })
    .from(seriesRequests)
    .where(eq(seriesRequests.id, id))
    .limit(1)
  return Number(row?.n ?? 0)
}

/** Which of `ids` this viewer has already voted for — one query for a whole page. */
export const votedRequestIds = async (
  db: Db,
  ids: readonly number[],
  voter: { voterKey?: Uint8Array | null; userId?: number | null },
): Promise<Set<number>> => {
  if (ids.length === 0) return new Set()
  const identity = [
    voter.voterKey ? eq(seriesRequestVotes.voterKey, voter.voterKey) : undefined,
    voter.userId ? eq(seriesRequestVotes.userId, voter.userId) : undefined,
  ].filter(Boolean)
  if (identity.length === 0) return new Set()
  const rows = await db
    .select({ requestId: seriesRequestVotes.requestId })
    .from(seriesRequestVotes)
    .where(and(inArray(seriesRequestVotes.requestId, [...ids]), or(...identity)))
  return new Set(rows.map((r) => r.requestId))
}

export interface SetStatusInput {
  id: number
  status: RequestStatus
  seriesId?: number | null
  declineReason?: string | null
  actorId: number
}

/**
 * Triage one request. `resolved_at` is set for every terminal status and cleared when a row
 * is put back to open or planned, so "how long did this sit" stays answerable. The database
 * refuses `added` / `exists` without a series (`series_requests_fulfilled_check`), which is
 * what guarantees a fulfilled row on the board always has a working link.
 */
export const setRequestStatus = async (
  db: Db,
  input: SetStatusInput,
): Promise<RequestRow | null> => {
  const terminal =
    input.status === 'added' || input.status === 'exists' || input.status === 'declined'
  const updated = await db
    .update(seriesRequests)
    .set({
      status: input.status,
      seriesId: input.seriesId ?? null,
      declineReason: input.status === 'declined' ? (input.declineReason ?? null) : null,
      resolvedAt: terminal ? new Date() : null,
      resolvedBy: terminal ? input.actorId : null,
      updatedAt: new Date(),
    })
    .where(eq(seriesRequests.id, input.id))
    .returning({ id: seriesRequests.id })
  return updated[0] ? requestById(db, updated[0].id) : null
}

/** Named for the board because `MergeResult` is the *series* merge's (`./merge.ts`). */
export type RequestMergeResult =
  | { ok: true; moved: number; target: RequestRow }
  | { ok: false; reason: 'missing' | 'self' | 'target_merged' }

/**
 * Fold `sourceId` into `targetId`: move the votes, then mark the source merged.
 *
 * Moving is an insert with `ON CONFLICT DO NOTHING`, so somebody who voted for both ends up
 * with one vote on the survivor rather than two — the merge cannot inflate the number it
 * exists to make trustworthy.
 */
export const mergeRequests = async (
  db: Db,
  sourceId: number,
  targetId: number,
): Promise<RequestMergeResult> => {
  if (sourceId === targetId) return { ok: false, reason: 'self' }
  const rows = await db
    .select({ id: seriesRequests.id, merged: seriesRequests.mergedIntoId })
    .from(seriesRequests)
    .where(inArray(seriesRequests.id, [sourceId, targetId]))
  const source = rows.find((r) => r.id === sourceId)
  const target = rows.find((r) => r.id === targetId)
  if (!source || !target) return { ok: false, reason: 'missing' }
  if (target.merged !== null) return { ok: false, reason: 'target_merged' }

  const moved = await db.transaction(async (tx) => {
    const before = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(seriesRequestVotes)
      .where(eq(seriesRequestVotes.requestId, targetId))
    await tx.execute(sql`
      insert into ${seriesRequestVotes} (request_id, voter_key, user_id, created_at)
      select ${targetId}, voter_key, user_id, created_at
      from ${seriesRequestVotes} where request_id = ${sourceId}
      on conflict do nothing`)
    await tx.delete(seriesRequestVotes).where(eq(seriesRequestVotes.requestId, sourceId))
    await tx
      .update(seriesRequests)
      .set({ mergedIntoId: targetId, updatedAt: new Date() })
      .where(eq(seriesRequests.id, sourceId))
    const after = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(seriesRequestVotes)
      .where(eq(seriesRequestVotes.requestId, targetId))
    return Number(after[0]?.n ?? 0) - Number(before[0]?.n ?? 0)
  })
  const row = await requestById(db, targetId)
  return row ? { ok: true, moved, target: row } : { ok: false, reason: 'missing' }
}

/** Requests already folded into `id` — shown on the admin row so a merge is not invisible. */
export const mergedInto = async (
  db: Db,
  ids: readonly number[],
): Promise<Map<number, { id: number; title: string }[]>> => {
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({
      id: seriesRequests.id,
      title: seriesRequests.title,
      mergedIntoId: seriesRequests.mergedIntoId,
    })
    .from(seriesRequests)
    .where(
      and(isNotNull(seriesRequests.mergedIntoId), inArray(seriesRequests.mergedIntoId, [...ids])),
    )
    .orderBy(desc(seriesRequests.voteCount))
  const out = new Map<number, { id: number; title: string }[]>()
  for (const r of rows) {
    const key = r.mergedIntoId as number
    out.set(key, [...(out.get(key) ?? []), { id: r.id, title: r.title }])
  }
  return out
}
