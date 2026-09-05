import { type SQL, sql } from 'drizzle-orm'
import { type Db, executeRows } from '../client.js'
import type { SeriesType } from '../schema/enums.js'

/**
 * Series merge (docs/09 legacy import, docs/12 §7 "slugs never break links").
 *
 * Two rows for one work is the importer's characteristic failure. By the time it is noticed
 * readers have bookmarked both, rated both and commented on both, so the fix is not a delete:
 * every row that points at the loser has to end up pointing at the winner, the loser's URL
 * has to keep answering, and what happened has to be reconstructable afterwards.
 *
 * Three rules shape everything below.
 *
 * 1. **Preview and merge are the same code.** `previewMerge` is what the screen shows and
 *    what `mergeSeries` re-runs inside the transaction, after taking `FOR UPDATE` on both
 *    rows. An operator can never confirm a preview that has since gone stale.
 * 2. **Refuse rather than guess.** Overlapping chapter numbers whose pages differ, and a live
 *    import run, stop the merge with a reason. Nothing is silently discarded.
 * 3. **The loser's URL survives.** A `redirects` row 301s `/series/<loser>`, a `slug_history`
 *    row 301s every path *under* it (chapters included), and the loser's own slug is retired
 *    to a tombstone so it can never shadow either rule — `series.deleted_at` puts a slug on
 *    the proxy's 410 list, and 410 is checked before slug history (apps/web/lib/seo/proxy.ts).
 */

export interface SeriesBrief {
  id: number
  slug: string
  title: string
  type: SeriesType
  state: string
  chapterCount: number
  bookmarkCount: number
  ratingCount: number
  viewCount: number
  coverKey: string | null
  coverColor: string | null
  deletedAt: Date | null
}

/** One table's share of the move: rows repointed, folded into an existing row, or dropped. */
export interface MergeMove {
  key: string
  /** Rows whose `series_id` (or target) is rewritten to the winner. */
  move: number
  /** Rows the winner already had an equivalent of — folded in or resolved, not moved. */
  merge: number
}

export interface ChapterOverlap {
  number: number
  loserChapterId: number
  winnerChapterId: number
  loserPages: number
  winnerPages: number
  /** Same ordered list of page keys on both sides — the loser's copy carries nothing new. */
  identical: boolean
}

export type RefusalCode =
  | 'same_series'
  | 'not_found'
  | 'deleted'
  | 'import_in_flight'
  | 'chapter_conflict'
  | 'adaptation'

export interface MergeRefusal {
  code: RefusalCode
  message: string
}

export type WarningCode =
  | 'direction'
  | 'type_mismatch'
  | 'open_takedown'
  | 'chapters_processing'
  | 'geo_conflict'
  | 'duplicate_chapters'

export interface MergeWarning {
  code: WarningCode
  message: string
}

export interface MergePreview {
  winner: SeriesBrief
  loser: SeriesBrief
  moves: MergeMove[]
  chapterOverlaps: ChapterOverlap[]
  refusals: MergeRefusal[]
  warnings: MergeWarning[]
  redirect: { fromPath: string; toPath: string }
  /** What the loser's slug becomes, so neither redirect rule can be shadowed by it. */
  tombstoneSlug: string
  totals: { move: number; merge: number }
}

export interface MergeInput {
  winnerId: number
  loserId: number
  actorId: number
  ipHash?: Uint8Array | null
}

export type MergeResult =
  | { ok: true; preview: MergePreview; auditId: number }
  | { ok: false; refusals: MergeRefusal[] }

export const seriesPathFor = (slug: string): string => `/series/${slug}`

/**
 * A `bytea` parameter as hex text. Drizzle sends `db.execute()` through postgres-js's
 * `unsafe()`, which carries no type hints, so a `Uint8Array` is left to the driver's guess;
 * `decode(…, 'hex')` states the type in the SQL instead of relying on it.
 */
const hex = (bytes: Uint8Array | null | undefined): SQL =>
  bytes ? sql`decode(${Buffer.from(bytes).toString('hex')}, 'hex')` : sql`null`

/** `solo-leveling-2` on series 91 → `merged-91-solo-leveling-2`, capped to the column's use. */
export const tombstoneSlugFor = (loserId: number, slug: string): string =>
  `merged-${loserId}-${slug}`.slice(0, 190)

interface RawBrief extends Record<string, unknown> {
  id: number
  slug: string
  title: string
  type: SeriesType
  state: string
  chapter_count: number
  bookmark_count: number
  rating_count: number
  view_count: number | string
  cover_key: string | null
  cover_color: string | null
  deleted_at: Date | null
}

const toBrief = (r: RawBrief): SeriesBrief => ({
  id: Number(r.id),
  slug: r.slug,
  title: r.title,
  type: r.type,
  state: r.state,
  chapterCount: Number(r.chapter_count),
  bookmarkCount: Number(r.bookmark_count),
  ratingCount: Number(r.rating_count),
  viewCount: Number(r.view_count),
  coverKey: r.cover_key,
  coverColor: r.cover_color,
  deletedAt: r.deleted_at ? new Date(r.deleted_at as unknown as string) : null,
})

const briefs = (db: Db, ids: number[], lock: boolean) =>
  executeRows<RawBrief>(
    db,
    sql`select id, slug::text as slug, title, type::text as type, state::text as state,
               chapter_count, bookmark_count, rating_count, view_count,
               cover_key, cover_color, deleted_at
        from series where id = any(${sql`array[${sql.join(
          ids.map((i) => sql`${i}::bigint`),
          sql`, `,
        )}]`}) ${lock ? sql`for update` : sql``}`,
  )

/**
 * Every table that points at a series, with the row counts a move would produce.
 *
 * `move` is rows whose pointer is rewritten; `merge` is rows the winner already has an
 * equivalent of, which are resolved in the winner's favour and then dropped. The two never
 * overlap, so `move + merge` is the loser's whole footprint in that table and a zero on both
 * means the table has nothing to do with this pair.
 */
const countMoves = async (db: Db, w: number, l: number): Promise<MergeMove[]> => {
  const [row] = await executeRows<Record<string, number | string>>(
    db,
    sql`select
      (select count(*) from chapters where series_id = ${l})::int as chapters_all,
      (select count(*) from chapters ca join chapters cw on cw.series_id = ${w} and cw.number = ca.number where ca.series_id = ${l})::int as chapters_overlap,
      (select count(*) from bookmarks b where b.series_id = ${l} and not exists (select 1 from bookmarks x where x.user_id = b.user_id and x.series_id = ${w}))::int as bookmarks_move,
      (select count(*) from bookmarks b where b.series_id = ${l} and exists (select 1 from bookmarks x where x.user_id = b.user_id and x.series_id = ${w}))::int as bookmarks_merge,
      (select count(*) from ratings r where r.series_id = ${l} and not exists (select 1 from ratings x where x.user_id = r.user_id and x.series_id = ${w}))::int as ratings_move,
      (select count(*) from ratings r where r.series_id = ${l} and exists (select 1 from ratings x where x.user_id = r.user_id and x.series_id = ${w}))::int as ratings_merge,
      (select count(*) from reading_progress p where p.series_id = ${l} and not exists (select 1 from reading_progress x where x.user_id = p.user_id and x.series_id = ${w}))::int as progress_move,
      (select count(*) from reading_progress p where p.series_id = ${l} and exists (select 1 from reading_progress x where x.user_id = p.user_id and x.series_id = ${w}))::int as progress_merge,
      (select count(*) from reading_list_items i where i.series_id = ${l} and not exists (select 1 from reading_list_items x where x.list_id = i.list_id and x.series_id = ${w}))::int as list_move,
      (select count(*) from reading_list_items i where i.series_id = ${l} and exists (select 1 from reading_list_items x where x.list_id = i.list_id and x.series_id = ${w}))::int as list_merge,
      (select count(*) from comments where series_id = ${l})::int as comments_move,
      (select count(*) from series_stats_daily d where d.series_id = ${l} and not exists (select 1 from series_stats_daily x where x.series_id = ${w} and x.bucket = d.bucket))::int as stats_move,
      (select count(*) from series_stats_daily d where d.series_id = ${l} and exists (select 1 from series_stats_daily x where x.series_id = ${w} and x.bucket = d.bucket))::int as stats_merge,
      (select count(*) from series_follows f where f.series_id = ${l} and not exists (select 1 from series_follows x where x.user_id = f.user_id and x.series_id = ${w}))::int as follows_move,
      (select count(*) from series_follows f where f.series_id = ${l} and exists (select 1 from series_follows x where x.user_id = f.user_id and x.series_id = ${w}))::int as follows_merge,
      (select count(*) from view_events v where v.series_id = ${l} and not exists (select 1 from view_events x where x.series_id = ${w} and x.bucket = v.bucket and x.viewer_key = v.viewer_key and x.chapter_id = v.chapter_id))::int as views_move,
      (select count(*) from view_events v where v.series_id = ${l} and exists (select 1 from view_events x where x.series_id = ${w} and x.bucket = v.bucket and x.viewer_key = v.viewer_key and x.chapter_id = v.chapter_id))::int as views_merge,
      (select count(*) from series_genres g where g.series_id = ${l} and not exists (select 1 from series_genres x where x.series_id = ${w} and x.genre_id = g.genre_id))::int as genres_move,
      (select count(*) from series_genres g where g.series_id = ${l} and exists (select 1 from series_genres x where x.series_id = ${w} and x.genre_id = g.genre_id))::int as genres_merge,
      (select count(*) from series_people p where p.series_id = ${l} and not exists (select 1 from series_people x where x.series_id = ${w} and x.person_id = p.person_id and x.credit = p.credit))::int as people_move,
      (select count(*) from series_people p where p.series_id = ${l} and exists (select 1 from series_people x where x.series_id = ${w} and x.person_id = p.person_id and x.credit = p.credit))::int as people_merge,
      (select count(*) from series_titles t where t.series_id = ${l} and not exists (select 1 from series_titles x where x.series_id = ${w} and x.title = t.title))::int as titles_move,
      (select count(*) from series_titles t where t.series_id = ${l} and exists (select 1 from series_titles x where x.series_id = ${w} and x.title = t.title))::int as titles_merge,
      (select count(*) from geo_restrictions g where g.series_id = ${l} and not exists (select 1 from geo_restrictions x where x.series_id = ${w} and x.country = g.country))::int as geo_move,
      (select count(*) from geo_restrictions g where g.series_id = ${l} and exists (select 1 from geo_restrictions x where x.series_id = ${w} and x.country = g.country))::int as geo_merge,
      (select count(*) from takedowns where series_id = ${l})::int as takedowns_move,
      (select count(*) from reports where target_type = 'series' and target_id = ${l})::int as reports_move,
      (select count(*) from import_map where kind = 'series' and target_id = ${l})::int as import_move,
      (select count(*) from slug_history h where h.entity_type = 'series' and h.entity_id = ${l})::int as slugs_move,
      (select count(*) from series where linked_series_id = ${l})::int as linked_move,
      (select count(*) from redirects r, series s where s.id = ${l} and r.to_path = '/series/' || s.slug::text and r.deleted_at is null)::int as redirects_move`,
  )
  const n = (k: string) => Number(row?.[k] ?? 0)
  const all = n('chapters_all')
  const overlap = n('chapters_overlap')
  const pair = (key: string, move: number, merge = 0): MergeMove => ({ key, move, merge })
  return [
    pair('chapters', all - overlap, overlap),
    pair('bookmarks', n('bookmarks_move'), n('bookmarks_merge')),
    pair('follows', n('follows_move'), n('follows_merge')),
    pair('ratings', n('ratings_move'), n('ratings_merge')),
    pair('reading_progress', n('progress_move'), n('progress_merge')),
    pair('reading_list_items', n('list_move'), n('list_merge')),
    pair('comments', n('comments_move')),
    pair('series_stats_daily', n('stats_move'), n('stats_merge')),
    pair('view_events', n('views_move'), n('views_merge')),
    pair('series_genres', n('genres_move'), n('genres_merge')),
    pair('series_people', n('people_move'), n('people_merge')),
    pair('series_titles', n('titles_move'), n('titles_merge')),
    pair('geo_restrictions', n('geo_move'), n('geo_merge')),
    pair('takedowns', n('takedowns_move')),
    pair('reports', n('reports_move')),
    pair('import_map', n('import_move')),
    pair('slug_history', n('slugs_move')),
    pair('linked_series', n('linked_move')),
    pair('redirects', n('redirects_move')),
  ]
}

/**
 * Chapter numbers present on both sides.
 *
 * `chapters_series_id_number_unique` covers soft-deleted rows too, so a number taken on the
 * winner blocks the loser's copy from moving whatever state either is in. Two chapters count
 * as the same upload when their pages are the same objects in the same order — that is the
 * only case where dropping one of them loses nothing.
 */
const chapterOverlaps = async (db: Db, w: number, l: number): Promise<ChapterOverlap[]> => {
  const rows = await executeRows<{
    number: string | number
    loser_id: number
    winner_id: number
    loser_pages: number
    winner_pages: number
    identical: boolean
  }>(
    db,
    sql`select ca.number::text as number, ca.id as loser_id, cw.id as winner_id,
               ca.page_count as loser_pages, cw.page_count as winner_pages,
               (coalesce((select array_agg(p.key order by p.idx) from chapter_pages p where p.chapter_id = ca.id), '{}')
                = coalesce((select array_agg(p.key order by p.idx) from chapter_pages p where p.chapter_id = cw.id), '{}')) as identical
        from chapters ca
        join chapters cw on cw.series_id = ${w} and cw.number = ca.number
        where ca.series_id = ${l}
        order by ca.number`,
  )
  return rows.map((r) => ({
    number: Number(r.number),
    loserChapterId: Number(r.loser_id),
    winnerChapterId: Number(r.winner_id),
    loserPages: Number(r.loser_pages),
    winnerPages: Number(r.winner_pages),
    identical: r.identical === true,
  }))
}

/**
 * What the merge would do, and every reason it would not. Safe to call outside a
 * transaction — `mergeSeries` calls it again under `FOR UPDATE` before it writes anything.
 */
export const previewMerge = async (
  db: Db,
  winnerId: number,
  loserId: number,
  opts: { lock?: boolean } = {},
): Promise<MergePreview> => {
  const refusals: MergeRefusal[] = []
  const warnings: MergeWarning[] = []
  const rows = await briefs(db, [winnerId, loserId], opts.lock === true)
  const winner = rows.map(toBrief).find((r) => r.id === winnerId)
  const loser = rows.map(toBrief).find((r) => r.id === loserId)

  const blank: SeriesBrief = {
    id: 0,
    slug: '',
    title: '',
    type: 'manga',
    state: 'draft',
    chapterCount: 0,
    bookmarkCount: 0,
    ratingCount: 0,
    viewCount: 0,
    coverKey: null,
    coverColor: null,
    deletedAt: null,
  }
  if (winnerId === loserId)
    refusals.push({ code: 'same_series', message: 'A series cannot be merged into itself.' })
  if (!winner || !loser)
    refusals.push({ code: 'not_found', message: 'One of the two series no longer exists.' })
  if (winner?.deletedAt || loser?.deletedAt)
    refusals.push({
      code: 'deleted',
      message: 'One of the two series is in the trash. Restore it or pick another pair.',
    })

  if (!winner || !loser || winnerId === loserId) {
    return {
      winner: winner ?? blank,
      loser: loser ?? blank,
      moves: [],
      chapterOverlaps: [],
      refusals,
      warnings,
      redirect: { fromPath: '', toPath: '' },
      tombstoneSlug: '',
      totals: { move: 0, merge: 0 },
    }
  }

  const [importRun] = await executeRows<{ id: number; status: string; phase: string }>(
    db,
    sql`select id, status, phase from import_runs where status in ('queued','running','paused') limit 1`,
  )
  if (importRun)
    refusals.push({
      code: 'import_in_flight',
      message: `Import run #${Number(importRun.id)} is ${importRun.status} (phase ${importRun.phase}). It writes series and chapters through import_map; merging under it would move rows the run is about to rewrite. Finish or cancel the run first.`,
    })

  if ((winner.type === 'novel') !== (loser.type === 'novel'))
    refusals.push({
      code: 'adaptation',
      message: `${winner.type} and ${loser.type} are different works, not duplicates — a novel and its comic adaptation each keep their own chapters and ratings. Link them with “Related series” on the editor instead.`,
    })

  const overlaps = await chapterOverlaps(db, winnerId, loserId)
  const conflicting = overlaps.filter((o) => !o.identical)
  if (conflicting.length > 0)
    refusals.push({
      code: 'chapter_conflict',
      message: `${conflicting.length} chapter ${conflicting.length === 1 ? 'number is' : 'numbers are'} used on both sides with different pages: ${conflicting
        .slice(0, 12)
        .map((c) => c.number)
        .join(
          ', ',
        )}${conflicting.length > 12 ? ' …' : ''}. Renumber or delete one side before merging.`,
    })

  const moves = await countMoves(db, winnerId, loserId)

  const identical = overlaps.filter((o) => o.identical)
  if (identical.length > 0)
    warnings.push({
      code: 'duplicate_chapters',
      message: `${identical.length} chapter ${identical.length === 1 ? 'number carries' : 'numbers carry'} the same pages on both sides (${identical
        .slice(0, 12)
        .map((c) => c.number)
        .join(
          ', ',
        )}). The loser's copy is retired and everything hanging off it — comments, read marks, per-chapter views — moves to the winner's.`,
    })
  if (loser.bookmarkCount > winner.bookmarkCount || loser.viewCount > winner.viewCount)
    warnings.push({
      code: 'direction',
      message: `The losing side has more readers (${loser.bookmarkCount} bookmarks · ${loser.viewCount} views) than the winner (${winner.bookmarkCount} · ${winner.viewCount}). Check the direction: the winner's slug, cover and synopsis are what survives.`,
    })
  if (winner.type !== loser.type)
    warnings.push({
      code: 'type_mismatch',
      message: `Types differ (${winner.type} vs ${loser.type}). The winner's type is kept.`,
    })

  const [extra] = await executeRows<{ takedowns: number; processing: number; geo: number }>(
    db,
    sql`select
      (select count(*) from takedowns where series_id = ${loserId} and actioned_at is null)::int as takedowns,
      (select count(*) from chapters where series_id = ${loserId} and state in ('processing','ready') and deleted_at is null)::int as processing,
      (select count(*) from geo_restrictions g join geo_restrictions x on x.series_id = ${winnerId} and x.country = g.country and x.mode <> g.mode where g.series_id = ${loserId})::int as geo`,
  )
  if (Number(extra?.takedowns ?? 0) > 0)
    warnings.push({
      code: 'open_takedown',
      message: `${Number(extra?.takedowns)} DMCA notice(s) against the losing series are still on the clock. They move to the winner and stay open — check Community → Takedowns after merging.`,
    })
  if (Number(extra?.processing ?? 0) > 0)
    warnings.push({
      code: 'chapters_processing',
      message: `${Number(extra?.processing)} chapter(s) on the losing series are still being processed. The worker keys off chapter ids, so they finish on the winner.`,
    })
  if (Number(extra?.geo ?? 0) > 0)
    warnings.push({
      code: 'geo_conflict',
      message: `Both sides restrict the same countries with opposite modes. The winner's rule is kept.`,
    })

  return {
    winner,
    loser,
    moves,
    chapterOverlaps: overlaps,
    refusals,
    warnings,
    redirect: { fromPath: seriesPathFor(loser.slug), toPath: seriesPathFor(winner.slug) },
    tombstoneSlug: tombstoneSlugFor(loser.id, loser.slug),
    totals: {
      move: moves.reduce((t, m) => t + m.move, 0),
      merge: moves.reduce((t, m) => t + m.merge, 0),
    },
  }
}

/**
 * Fold `loserId` into `winnerId` in one transaction, or refuse and change nothing.
 *
 * The audit row is written inside the same transaction as the moves, so there is no state in
 * which the data moved and the record of it did not. Its `after` payload carries the whole
 * preview — per-table counts, the chapters that were retired, the redirect that was left —
 * which is what makes the operation reconstructable from `/admin/audit` alone.
 */
export const mergeSeries = async (db: Db, input: MergeInput): Promise<MergeResult> => {
  const { winnerId: w, loserId: l } = input
  return db.transaction(async (tx) => {
    const preview = await previewMerge(tx as unknown as Db, w, l, { lock: true })
    if (preview.refusals.length > 0) return { ok: false, refusals: preview.refusals }
    const t = tx as unknown as Db
    const run = (query: Parameters<Db['execute']>[0]) => t.execute(query)

    // 1. Chapters whose number is taken on the winner by the same pages: retire the loser's
    //    copy and move everything hanging off it, so no reader loses a comment or a read mark.
    for (const o of preview.chapterOverlaps) {
      const lc = o.loserChapterId
      const wc = o.winnerChapterId
      await run(sql`update comments set chapter_id = ${wc} where chapter_id = ${lc}`)
      await run(sql`update chapter_reads r set chapter_id = ${wc}
        where r.chapter_id = ${lc}
          and not exists (select 1 from chapter_reads x where x.user_id = r.user_id and x.chapter_id = ${wc})`)
      await run(sql`delete from chapter_reads where chapter_id = ${lc}`)
      await run(sql`insert into chapter_stats_daily (chapter_id, bucket, views)
        select ${wc}, bucket, views from chapter_stats_daily where chapter_id = ${lc}
        on conflict (chapter_id, bucket) do update set views = chapter_stats_daily.views + excluded.views`)
      await run(sql`delete from chapter_stats_daily where chapter_id = ${lc}`)
      await run(sql`update view_events v set chapter_id = ${wc}
        where v.chapter_id = ${lc}
          and not exists (select 1 from view_events x where x.bucket = v.bucket and x.series_id = v.series_id and x.viewer_key = v.viewer_key and x.chapter_id = ${wc})`)
      await run(sql`delete from view_events where chapter_id = ${lc}`)
      await run(sql`update chapter_groups g set chapter_id = ${wc}
        where g.chapter_id = ${lc}
          and not exists (select 1 from chapter_groups x where x.chapter_id = ${wc} and x.group_id = g.group_id)`)
      await run(sql`delete from chapter_groups where chapter_id = ${lc}`)
      await run(sql`update reading_progress set chapter_id = ${wc} where chapter_id = ${lc}`)
      await run(sql`update takedowns set chapter_id = ${wc} where chapter_id = ${lc}`)
      await run(
        sql`update reports set target_id = ${wc} where target_type = 'chapter' and target_id = ${lc}`,
      )
      await run(
        sql`update import_map set target_id = ${wc} where kind = 'chapter' and target_id = ${lc}`,
      )
      // The retired copy's views move to the surviving one and are zeroed there, so the same
      // views are never counted twice by anything that sums `chapters.view_count`.
      await run(sql`update chapters set view_count = view_count
        + coalesce((select view_count from chapters where id = ${lc}), 0) where id = ${wc}`)
      await run(sql`update chapters
        set deleted_at = now(), state = 'removed', view_count = 0, updated_at = now()
        where id = ${lc}`)
    }

    // 2. Everything else the loser owns. Each table moves what it can and drops what the
    //    winner already has an equivalent of — the counts in the preview are these two sets.
    const retired = preview.chapterOverlaps.map((o) => o.loserChapterId)
    await run(
      retired.length === 0
        ? sql`update chapters set series_id = ${w}, updated_at = now() where series_id = ${l}`
        : sql`update chapters set series_id = ${w}, updated_at = now()
             where series_id = ${l} and id <> all(${sql`array[${sql.join(
               retired.map((id) => sql`${id}::bigint`),
               sql`, `,
             )}]`})`,
    )

    await run(sql`update bookmarks b set series_id = ${w}
      where b.series_id = ${l}
        and not exists (select 1 from bookmarks x where x.user_id = b.user_id and x.series_id = ${w})`)
    await run(sql`delete from bookmarks where series_id = ${l}`)

    // Follows are the subscription itself, so losing one silently unsubscribes a reader who
    // never bookmarked — and losing a `mode: 'off'` row is worse: the bookmark moves without
    // it, `mergeFollowers` reads that orphaned bookmark as an implicit follow on `all`, and
    // the merge re-subscribes somebody who deliberately muted the series. On a collision the
    // quieter of the two modes wins, because a merge may take notifications away from a
    // reader who asked for that, and must never hand them back.
    await run(sql`update series_follows f set series_id = ${w}
      where f.series_id = ${l}
        and not exists (select 1 from series_follows x where x.user_id = f.user_id and x.series_id = ${w})`)
    await run(sql`update series_follows w set mode = 'off', updated_at = now()
      from series_follows l
      where w.user_id = l.user_id and w.series_id = ${w} and l.series_id = ${l} and l.mode = 'off'`)
    await run(sql`delete from series_follows where series_id = ${l}`)

    await run(sql`update ratings r set series_id = ${w}
      where r.series_id = ${l}
        and not exists (select 1 from ratings x where x.user_id = r.user_id and x.series_id = ${w})`)
    await run(sql`delete from ratings where series_id = ${l}`)

    // A merge must never rewind anyone: where a reader has progress on both, the later
    // position wins rather than the winner's by default.
    await run(sql`update reading_progress wp
      set chapter_id = lp.chapter_id, page_idx = lp.page_idx, scroll_pct = lp.scroll_pct, read_at = lp.read_at
      from reading_progress lp
      where wp.user_id = lp.user_id and wp.series_id = ${w} and lp.series_id = ${l} and lp.read_at > wp.read_at`)
    await run(sql`update reading_progress p set series_id = ${w}
      where p.series_id = ${l}
        and not exists (select 1 from reading_progress x where x.user_id = p.user_id and x.series_id = ${w})`)
    await run(sql`delete from reading_progress where series_id = ${l}`)

    await run(sql`update reading_list_items i set series_id = ${w}
      where i.series_id = ${l}
        and not exists (select 1 from reading_list_items x where x.list_id = i.list_id and x.series_id = ${w})`)
    await run(sql`delete from reading_list_items where series_id = ${l}`)
    // `position` is dense by contract (queries/lists.ts); a dropped duplicate leaves a hole.
    await run(sql`with ordered as (
        select list_id, series_id,
               (row_number() over (partition by list_id order by position, added_at, series_id) - 1)::int as pos
        from reading_list_items
        where list_id in (select list_id from reading_list_items where series_id = ${w})
      )
      update reading_list_items i set position = o.pos
      from ordered o
      where o.list_id = i.list_id and o.series_id = i.series_id and i.position <> o.pos`)

    await run(sql`update comments set series_id = ${w} where series_id = ${l}`)

    await run(sql`insert into series_stats_daily (series_id, bucket, views)
      select ${w}, bucket, views from series_stats_daily where series_id = ${l}
      on conflict (series_id, bucket) do update set views = series_stats_daily.views + excluded.views`)
    await run(sql`delete from series_stats_daily where series_id = ${l}`)

    await run(sql`update view_events v set series_id = ${w}
      where v.series_id = ${l}
        and not exists (select 1 from view_events x where x.bucket = v.bucket and x.series_id = ${w} and x.viewer_key = v.viewer_key and x.chapter_id = v.chapter_id)`)
    await run(sql`delete from view_events where series_id = ${l}`)

    await run(sql`update series_genres g set series_id = ${w}
      where g.series_id = ${l}
        and not exists (select 1 from series_genres x where x.series_id = ${w} and x.genre_id = g.genre_id)`)
    await run(sql`delete from series_genres where series_id = ${l}`)

    await run(sql`update series_people p set series_id = ${w}
      where p.series_id = ${l}
        and not exists (select 1 from series_people x where x.series_id = ${w} and x.person_id = p.person_id and x.credit = p.credit)`)
    await run(sql`delete from series_people where series_id = ${l}`)

    await run(sql`update series_titles t set series_id = ${w}
      where t.series_id = ${l}
        and not exists (select 1 from series_titles x where x.series_id = ${w} and x.title = t.title)`)
    await run(sql`delete from series_titles where series_id = ${l}`)
    // The loser's own name becomes an alias of the winner, so search still finds it.
    await run(sql`insert into series_titles (series_id, title, lang)
      select ${w}, ${preview.loser.title}, null
      where ${preview.loser.title} <> ${preview.winner.title}
      on conflict on constraint series_titles_series_id_title_unique do nothing`)

    await run(sql`update geo_restrictions g set series_id = ${w}
      where g.series_id = ${l}
        and not exists (select 1 from geo_restrictions x where x.series_id = ${w} and x.country = g.country)`)
    await run(sql`delete from geo_restrictions where series_id = ${l}`)

    await run(sql`update takedowns set series_id = ${w} where series_id = ${l}`)
    await run(
      sql`update reports set target_id = ${w} where target_type = 'series' and target_id = ${l}`,
    )
    await run(
      sql`update import_map set target_id = ${w} where kind = 'series' and target_id = ${l}`,
    )

    // 3. The URL. `slug_history` covers every path under /series/<loser> (chapters included);
    //    the explicit `redirects` row covers the series page itself and is what an operator
    //    can see and edit in Admin → SEO. The loser's slug is retired last so neither rule
    //    resolves back to a row that is about to be marked removed.
    await run(
      sql`update slug_history set entity_id = ${w} where entity_type = 'series' and entity_id = ${l}`,
    )
    await run(sql`insert into slug_history (entity_type, old_slug, entity_id)
      values ('series', ${preview.loser.slug}, ${w})
      on conflict (entity_type, old_slug) do update set entity_id = excluded.entity_id`)
    await run(sql`update redirects set to_path = ${preview.redirect.toPath}
      where to_path = ${preview.redirect.fromPath}`)
    await run(sql`insert into redirects (from_path, to_path, status, created_by)
      values (${preview.redirect.fromPath}, ${preview.redirect.toPath}, 301, ${input.actorId})
      on conflict (from_path) do update
        set to_path = excluded.to_path, status = 301, deleted_at = null`)
    // A rule that now points at itself is a loop, not a redirect.
    await run(
      sql`update redirects set deleted_at = now() where from_path = to_path and deleted_at is null`,
    )

    await run(
      sql`update series set linked_series_id = ${w} where linked_series_id = ${l} and id <> ${w}`,
    )
    await run(
      sql`update series set linked_series_id = null where id = ${w} and linked_series_id = ${l}`,
    )

    await run(
      sql`update series set view_count = view_count + ${preview.loser.viewCount} where id = ${w}`,
    )
    await run(sql`update series
      set slug = ${preview.tombstoneSlug}, state = 'removed', deleted_at = now(),
          view_count = 0, bookmark_count = 0, rating_sum = 0, rating_count = 0,
          is_featured = false, is_pinned = false, updated_at = now()
      where id = ${l}`)

    // 4. Counters. The chapter trigger (migration 0002) already fired on the UPDATEs above;
    //    the row-level bookmark and rating triggers do not fire on an `series_id` change, so
    //    both are recounted from their source tables rather than adjusted by hand.
    await run(sql`update series s set
        bookmark_count = (select count(*) from bookmarks b where b.series_id = s.id),
        rating_count = (select count(*) from ratings r where r.series_id = s.id),
        rating_sum = (select coalesce(sum(r.score), 0) from ratings r where r.series_id = s.id),
        updated_at = now()
      where s.id = ${w}`)
    await run(sql`select series_refresh_chapter_counters(array[${w}::bigint, ${l}::bigint])`)

    const [after] = await executeRows<{ id: number }>(
      t,
      sql`insert into audit_log (actor_id, action, target_type, target_id, before, after, ip_hash)
          values (${input.actorId}, 'series.merge', 'series', ${w},
                  ${JSON.stringify({
                    loser: preview.loser,
                    winner: preview.winner,
                  })}::jsonb,
                  ${JSON.stringify({
                    winnerId: w,
                    loserId: l,
                    loserSlug: preview.loser.slug,
                    loserTitle: preview.loser.title,
                    tombstoneSlug: preview.tombstoneSlug,
                    redirect: preview.redirect,
                    moves: preview.moves.filter((m) => m.move + m.merge > 0),
                    totals: preview.totals,
                    retiredChapters: preview.chapterOverlaps.map((o) => ({
                      number: o.number,
                      loserChapterId: o.loserChapterId,
                      winnerChapterId: o.winnerChapterId,
                    })),
                    warnings: preview.warnings.map((x) => x.code),
                  })}::jsonb,
                  ${hex(input.ipHash)})
          returning id`,
    )
    return { ok: true, preview, auditId: Number(after?.id ?? 0) }
  })
}
