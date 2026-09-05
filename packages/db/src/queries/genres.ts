import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { type Db, executeRows } from '../client.js'
import { genres, series, seriesGenres } from '../schema/index.js'

/**
 * Genres, themes and formats — the taxonomy behind /genres, the browse filter panel and the
 * genre picker on the series editor, plus everything `Admin → Content → Genres` needs to
 * operate it (migration 9028).
 *
 * Two rules shape the write side, and both come from `merge.ts`, which had to solve the same
 * problems for series first.
 *
 * 1. **A slug is a URL, and URLs do not break.** `/genres/<slug>` is crawlable and linked
 *    from every series page. Renaming one writes the old slug to `slug_history`, which
 *    `apps/web/lib/seo/{snapshot,proxy}.ts` already turns into a 301 for `/genres/<old>` and
 *    every path under it — the machinery existed, nothing had ever written to it. The
 *    inverse case matters just as much: taking a slug back (creating or renaming *to* a slug
 *    that history still points elsewhere) deletes that history row, because a live page must
 *    always beat a redirect or the new genre would 301 away to the old one.
 * 2. **Preview and merge are the same code.** `previewGenreMerge` is what the screen renders
 *    and what `mergeGenres` re-runs inside the transaction under a row lock; a preview that
 *    went stale between render and click cannot be confirmed.
 */

export interface GenreCount {
  id: number
  slug: string
  name: string
  kind: string
  count: number
}

/**
 * Every live genre/theme/format with its count of published series (zero included), in the
 * operator's order: `kind`, then `position`, then name as the tiebreak for rows an operator
 * has never touched. Retired genres are excluded — they are not a public page any more.
 */
export const genreCounts = async (db: Db, kind?: string): Promise<GenreCount[]> => {
  const count = sql<number>`count(${series.id})::int`
  const rows = await db
    .select({ id: genres.id, slug: genres.slug, name: genres.name, kind: genres.kind, count })
    .from(genres)
    .leftJoin(seriesGenres, eq(seriesGenres.genreId, genres.id))
    .leftJoin(
      series,
      and(
        eq(series.id, seriesGenres.seriesId),
        eq(series.state, 'published'),
        isNull(series.deletedAt),
      ),
    )
    .where(and(isNull(genres.deletedAt), kind ? eq(genres.kind, kind) : undefined))
    .groupBy(genres.id)
    .orderBy(asc(genres.kind), asc(genres.position), asc(genres.name))
  return rows.map((r) => ({ ...r, count: Number(r.count) }))
}

/** One live genre by slug. A retired genre is not found: its URL is the proxy's job now. */
export const genreBySlug = async (db: Db, slug: string) => {
  const [row] = await db
    .select()
    .from(genres)
    .where(and(eq(genres.slug, slug), isNull(genres.deletedAt)))
    .limit(1)
  return row ?? null
}

export const GENRE_KINDS = ['genre', 'theme', 'format'] as const
export type GenreKind = (typeof GENRE_KINDS)[number]

export const isGenreKind = (v: unknown): v is GenreKind =>
  typeof v === 'string' && (GENRE_KINDS as readonly string[]).includes(v)

export const genrePathFor = (slug: string): string => `/genres/${slug}`

/** `action` on genre 12 → `merged-12-action`: the retired slug, freed for reuse. */
export const genreTombstoneSlugFor = (loserId: number, slug: string): string =>
  `merged-${loserId}-${slug}`.slice(0, 190)

/* ------------------------------------------------------------------ admin listing */

export interface AdminGenre {
  id: number
  slug: string
  name: string
  kind: string
  position: number
  /** Every `series_genres` row, including drafts and trashed series. */
  seriesCount: number
  /** The subset the public /genres count shows. */
  publishedCount: number
  deletedAt: Date | null
  mergedIntoId: number | null
  mergedIntoName: string | null
  mergedIntoSlug: string | null
  hasSeo: boolean
}

interface RawAdminGenre extends Record<string, unknown> {
  id: number
  slug: string
  name: string
  kind: string
  position: number
  series_count: number
  published_count: number
  deleted_at: Date | string | null
  merged_into_id: number | null
  merged_into_name: string | null
  merged_into_slug: string | null
  has_seo: boolean
}

/**
 * The admin list: every genre including the retired ones, with both counts. Two counts
 * rather than one because they answer different questions — the published count is what a
 * reader sees, the total is what a delete would strand.
 */
export const adminGenres = async (db: Db): Promise<AdminGenre[]> => {
  const rows = await executeRows<RawAdminGenre>(
    db,
    sql`select g.id, g.slug::text as slug, g.name, g.kind, g.position,
               g.deleted_at, g.merged_into_id,
               w.name as merged_into_name, w.slug::text as merged_into_slug,
               (g.seo_title is not null or g.seo_description is not null
                or g.intro is not null or g.faq is not null) as has_seo,
               (select count(*) from series_genres sg where sg.genre_id = g.id)::int as series_count,
               (select count(*) from series_genres sg
                  join series s on s.id = sg.series_id
                 where sg.genre_id = g.id and s.state = 'published' and s.deleted_at is null
               )::int as published_count
        from genres g
        left join genres w on w.id = g.merged_into_id
        order by g.deleted_at nulls first, g.kind, g.position, g.name`,
  )
  return rows.map((r) => ({
    id: Number(r.id),
    slug: r.slug,
    name: r.name,
    kind: r.kind,
    position: Number(r.position),
    seriesCount: Number(r.series_count),
    publishedCount: Number(r.published_count),
    deletedAt: r.deleted_at ? new Date(r.deleted_at as string) : null,
    mergedIntoId: r.merged_into_id === null ? null : Number(r.merged_into_id),
    mergedIntoName: r.merged_into_name,
    mergedIntoSlug: r.merged_into_slug,
    hasSeo: r.has_seo === true,
  }))
}

/* ------------------------------------------------------------------ create / update */

export interface GenreWrite {
  name: string
  slug: string
  kind: string
}

export interface GenreRow {
  id: number
  slug: string
  name: string
  kind: string
  position: number
  deletedAt: Date | null
}

const toRow = (r: Record<string, unknown>): GenreRow => ({
  id: Number(r.id),
  slug: String(r.slug),
  name: String(r.name),
  kind: String(r.kind),
  position: Number(r.position),
  deletedAt: r.deleted_at ? new Date(r.deleted_at as string) : null,
})

/**
 * A live slug beats a stale redirect.
 *
 * `slug_history` is keyed by (entity_type, old_slug), so a slug that was renamed away from
 * and is later taken again would still 301 to wherever history points — the new page would
 * be unreachable at its own address. Reclaiming the slug drops the row.
 */
const reclaimSlug = (db: Db, slug: string) =>
  db.execute(sql`delete from slug_history where entity_type = 'genre' and old_slug = ${slug}`)

/** Create a genre at the end of its kind's order. */
export const createGenre = async (db: Db, input: GenreWrite): Promise<GenreRow> =>
  db.transaction(async (tx) => {
    const t = tx as unknown as Db
    await reclaimSlug(t, input.slug)
    const [row] = await executeRows(
      t,
      sql`insert into genres (slug, name, kind, position)
          values (${input.slug}, ${input.name}, ${input.kind},
                  coalesce((select max(position) + 1 from genres where kind = ${input.kind}), 1))
          returning id, slug::text as slug, name, kind, position, deleted_at`,
    )
    if (!row) throw new Error('genre insert returned no row')
    return toRow(row)
  })

export interface GenreUpdateResult {
  before: GenreRow
  after: GenreRow
  /** The old slug, when it changed — a `slug_history` row now 301s it. */
  redirectedFrom: string | null
}

/**
 * Rename a genre, change its slug or move it between kinds.
 *
 * A slug change is the whole reason this is not one UPDATE: the old address has to keep
 * answering (a `slug_history` row), and the new address has to stop being redirected away
 * (`reclaimSlug`). Moving between kinds puts the row at the end of the new kind's order,
 * because a position is only meaningful inside one.
 */
export const updateGenre = async (
  db: Db,
  id: number,
  input: GenreWrite,
): Promise<GenreUpdateResult | null> =>
  db.transaction(async (tx) => {
    const t = tx as unknown as Db
    const [beforeRaw] = await executeRows(
      t,
      sql`select id, slug::text as slug, name, kind, position, deleted_at
          from genres where id = ${id} for update`,
    )
    if (!beforeRaw) return null
    const before = toRow(beforeRaw)
    const slugChanged = before.slug.toLowerCase() !== input.slug.toLowerCase()
    const kindChanged = before.kind !== input.kind

    if (slugChanged) {
      await reclaimSlug(t, input.slug)
      await t.execute(sql`insert into slug_history (entity_type, old_slug, entity_id)
        values ('genre', ${before.slug}, ${id})
        on conflict (entity_type, old_slug) do update set entity_id = excluded.entity_id`)
    }
    const [afterRaw] = await executeRows(
      t,
      sql`update genres set slug = ${input.slug}, name = ${input.name}, kind = ${input.kind},
                 position = ${
                   kindChanged
                     ? sql`coalesce((select max(position) + 1 from genres where kind = ${input.kind}), 1)`
                     : sql`position`
}
          where id = ${id}
          returning id, slug::text as slug, name, kind, position, deleted_at`,
    )
    if (!afterRaw) return null
    return { before, after: toRow(afterRaw), redirectedFrom: slugChanged ? before.slug : null }
  })

/**
 * Retire a genre. `series_genres` rows are deliberately left alone: they are what a restore
 * brings back, and dropping them is the one part of this action that could not be undone.
 * The genre disappears from /genres, from the browse filters and from the series editor, and
 * `/genres/<slug>` starts answering 404 — which is why the screen offers a merge instead
 * whenever the genre is still carried by anything.
 */
export const softDeleteGenre = async (db: Db, id: number): Promise<GenreRow | null> => {
  const [row] = await executeRows(
    db,
    sql`update genres set deleted_at = now() where id = ${id} and deleted_at is null
        returning id, slug::text as slug, name, kind, position, deleted_at`,
  )
  return row ? toRow(row) : null
}

/** Bring a retired genre back, with the attachments it kept. A merged loser cannot return. */
export const restoreGenre = async (db: Db, id: number): Promise<GenreRow | null> => {
  const [row] = await executeRows(
    db,
    sql`update genres set deleted_at = null
        where id = ${id} and deleted_at is not null and merged_into_id is null
        returning id, slug::text as slug, name, kind, position, deleted_at`,
  )
  return row ? toRow(row) : null
}

/**
 * Write the listing order for one kind from an ordered list of ids.
 *
 * Ids that are not live members of `kind` are ignored rather than trusted, so a stale tab
 * cannot move a row into another kind or resurrect a retired one. Positions are rewritten
 * densely from 1, and anything the caller left out keeps whatever position it had.
 */
export const reorderGenres = async (db: Db, kind: string, ids: number[]): Promise<number> => {
  if (ids.length === 0) return 0
  const list = sql.join(
    ids.map((id, i) => sql`(${id}::bigint, ${i + 1}::int)`),
    sql`, `,
  )
  const rows = await executeRows<{ id: number }>(
    db,
    sql`update genres g set position = v.pos
        from (values ${list}) as v(id, pos)
        where g.id = v.id and g.kind = ${kind} and g.deleted_at is null
        returning g.id`,
  )
  return rows.length
}

/* ------------------------------------------------------------------ merge */

export interface GenreBrief {
  id: number
  slug: string
  name: string
  kind: string
  seriesCount: number
  deletedAt: Date | null
  hasSeo: boolean
}

export type GenreRefusalCode = 'same_genre' | 'not_found' | 'deleted'
export type GenreWarningCode = 'kind_mismatch' | 'direction' | 'seo_loss' | 'empty'

export interface GenreMergeNote<C extends string> {
  code: C
  message: string
}

export interface GenreMergePreview {
  winner: GenreBrief
  loser: GenreBrief
  /** Series that gain the winner's tag because they only had the loser's. */
  move: number
  /** Series already carrying both — one row is dropped so the pair does not double up. */
  merge: number
  refusals: GenreMergeNote<GenreRefusalCode>[]
  warnings: GenreMergeNote<GenreWarningCode>[]
  redirect: { fromPath: string; toPath: string }
  tombstoneSlug: string
}

export interface GenreMergeInput {
  winnerId: number
  loserId: number
  actorId: number
  ipHash?: Uint8Array | null
}

export type GenreMergeResult =
  | { ok: true; preview: GenreMergePreview; auditId: number }
  | { ok: false; refusals: GenreMergeNote<GenreRefusalCode>[] }

interface RawGenreBrief extends Record<string, unknown> {
  id: number
  slug: string
  name: string
  kind: string
  series_count: number
  deleted_at: Date | string | null
  has_seo: boolean
}

const toBrief = (r: RawGenreBrief): GenreBrief => ({
  id: Number(r.id),
  slug: r.slug,
  name: r.name,
  kind: r.kind,
  seriesCount: Number(r.series_count),
  deletedAt: r.deleted_at ? new Date(r.deleted_at as string) : null,
  hasSeo: r.has_seo === true,
})

const genreBriefs = (db: Db, ids: number[], lock: boolean) =>
  executeRows<RawGenreBrief>(
    db,
    sql`select g.id, g.slug::text as slug, g.name, g.kind, g.deleted_at,
               (g.seo_title is not null or g.seo_description is not null
                or g.intro is not null or g.faq is not null) as has_seo,
               (select count(*) from series_genres sg where sg.genre_id = g.id)::int as series_count
        from genres g
        where g.id = any(${sql`array[${sql.join(
          ids.map((i) => sql`${i}::bigint`),
          sql`, `,
        )}]`}) ${lock ? sql`for no key update of g` : sql``}`,
  )

const BLANK_BRIEF: GenreBrief = {
  id: 0,
  slug: '',
  name: '',
  kind: 'genre',
  seriesCount: 0,
  deletedAt: null,
  hasSeo: false,
}

/**
 * What folding `loserId` into `winnerId` would do, and every reason it would not. Safe to
 * call outside a transaction — `mergeGenres` calls it again under a row lock before writing.
 */
export const previewGenreMerge = async (
  db: Db,
  winnerId: number,
  loserId: number,
  opts: { lock?: boolean } = {},
): Promise<GenreMergePreview> => {
  const refusals: GenreMergeNote<GenreRefusalCode>[] = []
  const warnings: GenreMergeNote<GenreWarningCode>[] = []
  const rows = (await genreBriefs(db, [winnerId, loserId], opts.lock === true)).map(toBrief)
  const winner = rows.find((r) => r.id === winnerId)
  const loser = rows.find((r) => r.id === loserId)

  if (winnerId === loserId)
    refusals.push({ code: 'same_genre', message: 'A genre cannot be merged into itself.' })
  if (!winner || !loser)
    refusals.push({ code: 'not_found', message: 'One of the two genres no longer exists.' })
  if (winner?.deletedAt || loser?.deletedAt)
    refusals.push({
      code: 'deleted',
      message: 'One of the two genres is already retired. Restore it or pick another pair.',
    })

  if (!winner || !loser || winnerId === loserId) {
    return {
      winner: winner ?? BLANK_BRIEF,
      loser: loser ?? BLANK_BRIEF,
      move: 0,
      merge: 0,
      refusals,
      warnings,
      redirect: { fromPath: '', toPath: '' },
      tombstoneSlug: '',
    }
  }

  const [counts] = await executeRows<{ move: number; merge: number }>(
    db,
    sql`select
      (select count(*) from series_genres g where g.genre_id = ${loserId}
         and not exists (select 1 from series_genres x
                          where x.series_id = g.series_id and x.genre_id = ${winnerId}))::int as move,
      (select count(*) from series_genres g where g.genre_id = ${loserId}
         and exists (select 1 from series_genres x
                      where x.series_id = g.series_id and x.genre_id = ${winnerId}))::int as merge`,
  )

  if (winner.kind !== loser.kind)
    warnings.push({
      code: 'kind_mismatch',
      message: `“${loser.name}” is a ${loser.kind} and “${winner.name}” is a ${winner.kind}. The series still move, but they land in a different section of /genres — check this is a reclassification and not the wrong pair.`,
    })
  if (loser.seriesCount > winner.seriesCount)
    warnings.push({
      code: 'direction',
      message: `The losing genre carries more series (${loser.seriesCount}) than the winner (${winner.seriesCount}). Check the direction: the winner's name, slug and SEO text are what survives.`,
    })
  if (loser.hasSeo)
    warnings.push({
      code: 'seo_loss',
      message: `“${loser.name}” has its own SEO title, description, intro or FAQ. None of it moves — the winner's page keeps the winner's text.`,
    })
  if (loser.seriesCount === 0)
    warnings.push({
      code: 'empty',
      message: `Nothing is tagged “${loser.name}”. This merge is only a redirect and a retirement — a delete would do the same, minus the 301.`,
    })

  return {
    winner,
    loser,
    move: Number(counts?.move ?? 0),
    merge: Number(counts?.merge ?? 0),
    refusals,
    warnings,
    redirect: { fromPath: genrePathFor(loser.slug), toPath: genrePathFor(winner.slug) },
    tombstoneSlug: genreTombstoneSlugFor(loser.id, loser.slug),
  }
}

/**
 * A `bytea` parameter as hex text. `db.execute()` carries no type hints, so a `Uint8Array`
 * is left to the driver's guess; `decode(…, 'hex')` states the type in the SQL instead.
 */
const hex = (bytes: Uint8Array | null | undefined) =>
  bytes ? sql`decode(${Buffer.from(bytes).toString('hex')}, 'hex')` : sql`null`

/**
 * Fold `loserId` into `winnerId` in one transaction, or refuse and change nothing.
 *
 * The order matters. Rows that can move are repointed first, then whatever is left of the
 * loser's rows is deleted — a series carrying both genres ends up carrying the winner once,
 * never twice and never zero times, which is the property the primary key on
 * (series_id, genre_id) would otherwise turn into a constraint violation.
 *
 * The audit row is written inside the same transaction as the moves, so there is no state in
 * which the rows moved and the record of it did not.
 */
export const mergeGenres = async (db: Db, input: GenreMergeInput): Promise<GenreMergeResult> => {
  const { winnerId: w, loserId: l } = input
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db
    const preview = await previewGenreMerge(t, w, l, { lock: true })
    if (preview.refusals.length > 0) return { ok: false, refusals: preview.refusals }

    // 1. Every series that carried only the loser now carries the winner…
    await t.execute(sql`update series_genres g set genre_id = ${w}
      where g.genre_id = ${l}
        and not exists (select 1 from series_genres x where x.series_id = g.series_id and x.genre_id = ${w})`)
    // …and the rest already did, so their loser row goes rather than doubling up.
    await t.execute(sql`delete from series_genres where genre_id = ${l}`)

    // 2. The URL. A `slug_history` row 301s /genres/<loser> and every path under it (the
    //    /feed route included); the explicit `redirects` row covers the page itself and is
    //    what an operator can see and edit in Admin → SEO. Names the loser was previously
    //    known by follow it to the winner rather than dead-ending on a retired row.
    await t.execute(
      sql`update slug_history set entity_id = ${w} where entity_type = 'genre' and entity_id = ${l}`,
    )
    await t.execute(sql`insert into slug_history (entity_type, old_slug, entity_id)
      values ('genre', ${preview.loser.slug}, ${w})
      on conflict (entity_type, old_slug) do update set entity_id = excluded.entity_id`)
    await t.execute(sql`update redirects set to_path = ${preview.redirect.toPath}
      where to_path = ${preview.redirect.fromPath} and deleted_at is null`)
    await t.execute(sql`insert into redirects (from_path, to_path, status, created_by)
      values (${preview.redirect.fromPath}, ${preview.redirect.toPath}, 301, ${input.actorId})
      on conflict (from_path) do update
        set to_path = excluded.to_path, status = 301, deleted_at = null`)
    // A rule that now points at itself is a loop, not a redirect.
    await t.execute(
      sql`update redirects set deleted_at = now() where from_path = to_path and deleted_at is null`,
    )

    // 3. The loser is retired last, and its slug with it — freed for reuse, and unable to
    //    shadow the redirect that now stands in its place.
    await t.execute(sql`update genres
      set slug = ${preview.tombstoneSlug}, deleted_at = now(), merged_into_id = ${w}
      where id = ${l}`)

    const [after] = await executeRows<{ id: number }>(
      t,
      sql`insert into audit_log (actor_id, action, target_type, target_id, before, after, ip_hash)
          values (${input.actorId}, 'genre.merge', 'genre', ${w},
                  ${JSON.stringify({ winner: preview.winner, loser: preview.loser })}::jsonb,
                  ${JSON.stringify({
                    winnerId: w,
                    loserId: l,
                    loserSlug: preview.loser.slug,
                    loserName: preview.loser.name,
                    tombstoneSlug: preview.tombstoneSlug,
                    redirect: preview.redirect,
                    move: preview.move,
                    merge: preview.merge,
                    warnings: preview.warnings.map((x) => x.code),
                  })}::jsonb,
                  ${hex(input.ipHash)})
          returning id`,
    )
    return { ok: true, preview, auditId: Number(after?.id ?? 0) }
  })
}
