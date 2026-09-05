import { sql } from 'drizzle-orm'
import { type Db, executeRows } from '../client.js'
import type { SeriesType } from '../schema/enums.js'

/**
 * Duplicate series detection (docs/09 legacy import, docs/17 §E).
 *
 * The importer maps a legacy row to a local one through `import_map`, so a *re-run* never
 * duplicates. Two different sources describing the same work do: `Solo Leveling`,
 * `solo-leveling-2` and `Na Honjaman Level Up` are three rows for one title, and by the time
 * anyone notices, readers have bookmarked more than one of them.
 *
 * Nothing here asserts that a pair *is* a duplicate. It gathers evidence, scores it, and
 * hands both to an operator — every number on the screen is one of the `MatchReason`s below,
 * so "why was this flagged" is answered by the row itself rather than by reading this file.
 *
 * ## Why it is not a self-join
 *
 * The obvious query — every name against every other name with `similarity()` — is O(n²)
 * over `series × series_titles` and degrades into a nested loop the moment the catalogue
 * stops being a toy. Instead each series drives three LATERAL probes that the existing
 * trigram GIN indexes (`series_title_trgm_idx`, `series_titles_title_trgm_idx`, both from
 * migration 0001) can answer with `%`, plus one grouping pass on the slug root. Candidate
 * generation is therefore index lookups per series, not a cross product, and the expensive
 * evidence (creators, genres, chapter overlap) is only gathered for pairs that survived.
 */

/** A trigram floor below `pg_trgm`'s own 0.3 default finds nothing extra and costs a scan. */
export const DEFAULT_NAME_THRESHOLD = 0.42

/** Pairs scoring under this are not worth an operator's attention. */
export const DEFAULT_MIN_SCORE = 40

/** How many candidate pairs a screen will look at. */
export const DEFAULT_LIMIT = 50

export type MatchReasonKind =
  | 'title_similarity'
  | 'exact_alias'
  | 'slug_root'
  | 'shared_creator'
  | 'same_type'
  | 'type_mismatch'
  | 'shared_genres'
  | 'same_year'

export interface MatchReason {
  kind: MatchReasonKind
  /** Points this reason contributed to the score; negative for evidence *against*. */
  points: number
  /** The evidence itself, rendered by the screen — e.g. the two titles that matched. */
  detail: string
}

export interface DuplicateSide {
  id: number
  slug: string
  title: string
  type: SeriesType
  state: string
  chapterCount: number
  bookmarkCount: number
  viewCount: number
  ratingCount: number
  coverKey: string | null
  coverColor: string | null
  createdAt: Date
  altTitles: string[]
}

export interface DuplicateCandidate {
  /** Higher of the two by reader investment — the side a merge would normally keep. */
  a: DuplicateSide
  b: DuplicateSide
  /** 0–100. A ranking aid, not a verdict. */
  score: number
  reasons: MatchReason[]
  /** The two names that matched most closely, and how closely. */
  bestMatch: { a: string; b: string; similarity: number } | null
  /** Chapter numbers present on both sides — the thing that decides whether a merge is safe. */
  overlappingChapters: number[]
}

/** The evidence gathered for one pair, before it is weighed. */
interface PairFacts {
  /** Best trigram similarity between any name on one side and any name on the other. */
  nameSim: number
  aName: string | null
  bName: string | null
  /** A name on each side that is identical once punctuation and season suffixes are dropped. */
  exactAlias: boolean
  exactAliasA: string | null
  exactAliasB: string | null
  /** The slug root both sides reduce to, when they share one. */
  slugRoot: string | null
  sharedPeople: string[]
  sharedGenres: string[]
}

/**
 * Normalise a name to its comparison key: case-folded, season/part/volume suffix removed,
 * everything that is not a letter or a digit dropped. `Solo Leveling: Season 2` and
 * `solo-leveling` collapse to the same key; `Solo Leveling` and `Solo Levelling` do not —
 * that near-miss is what the trigram pass is for.
 */
const NORM = (column: string) =>
  sql.raw(`
  regexp_replace(
    regexp_replace(
      regexp_replace(lower(btrim(${column})), '[[:space:]]*[:,\\-]?[[:space:]]*(season|part|vol\\.?|volume|book)[[:space:]]*[0-9ivx]+[[:space:]]*$', '', 'g'),
      '^(the|a|an)[[:space:]]+', ''),
    '[^a-z0-9]+', '', 'g')`)

/** The slug with a disambiguating numeric suffix removed: `solo-leveling-2` → `sololeveling`. */
const SLUG_ROOT = sql.raw(`
  regexp_replace(regexp_replace(lower(series.slug::text), '-[0-9]+$', ''), '[^a-z0-9]+', '', 'g')`)

export interface DuplicateOptions {
  threshold?: number
  minScore?: number
  limit?: number
  /** Restrict to pairs involving this series (the "is this one a duplicate?" view). */
  seriesId?: number
}

/**
 * Score one pair from its evidence. Pure, so the weights are assertable without a database —
 * and so the screen and this function can never disagree about why a pair was flagged.
 *
 * The weights encode one judgement: a *name* match is suggestive, and everything else is
 * corroboration. Nothing but corroboration can carry a pair over the threshold on its own,
 * and a novel paired with a comic is pushed below it however well the names match, because
 * that pair is an adaptation — `series.linked_series_id` exists for exactly that.
 */
export const scorePair = (
  facts: Pick<
    PairFacts,
    'nameSim' | 'exactAlias' | 'slugRoot' | 'sharedPeople' | 'sharedGenres' | 'aName' | 'bName'
  > & {
    aType: SeriesType
    bType: SeriesType
    aYear: number | null
    bYear: number | null
    aGenreCount: number
    bGenreCount: number
    exactAliasA?: string | null
    exactAliasB?: string | null
  },
): { score: number; reasons: MatchReason[] } => {
  const reasons: MatchReason[] = []
  const add = (kind: MatchReasonKind, points: number, detail: string) => {
    if (points !== 0) reasons.push({ kind, points, detail })
  }

  if (facts.nameSim > 0 && facts.aName && facts.bName)
    add(
      'title_similarity',
      Math.round(45 * Math.min(1, facts.nameSim)),
      `“${facts.aName}” ↔ “${facts.bName}” · ${(facts.nameSim * 100).toFixed(0)}% trigram similarity`,
    )
  if (facts.exactAlias)
    add(
      'exact_alias',
      25,
      facts.exactAliasA && facts.exactAliasB
        ? `“${facts.exactAliasA}” and “${facts.exactAliasB}” are the same name once punctuation and season suffixes are dropped`
        : 'A title on one side matches a title on the other exactly',
    )
  if (facts.slugRoot) add('slug_root', 15, `Both slugs reduce to “${facts.slugRoot}”`)
  if (facts.sharedPeople.length > 0)
    add(
      'shared_creator',
      12,
      `Same credited ${facts.sharedPeople.length === 1 ? 'creator' : 'creators'}: ${facts.sharedPeople.join(', ')}`,
    )

  const novelMismatch =
    (facts.aType === 'novel') !== (facts.bType === 'novel')
      ? `${facts.aType} vs ${facts.bType} — an adaptation, not a duplicate`
      : null
  if (novelMismatch) add('type_mismatch', -30, novelMismatch)
  else if (facts.aType === facts.bType) add('same_type', 5, `Both are ${facts.aType}`)
  else add('type_mismatch', -6, `${facts.aType} vs ${facts.bType}`)

  const union = Math.max(1, facts.aGenreCount + facts.bGenreCount - facts.sharedGenres.length)
  if (facts.sharedGenres.length > 0)
    add(
      'shared_genres',
      Math.round(8 * (facts.sharedGenres.length / union)),
      `${facts.sharedGenres.length} shared: ${facts.sharedGenres.slice(0, 5).join(', ')}`,
    )
  if (facts.aYear !== null && facts.aYear === facts.bYear)
    add('same_year', 5, `Both released ${facts.aYear}`)

  // An adaptation is not a near-miss to be judged on the balance of the evidence: the merge
  // refuses that pair outright (`previewMerge`, code `adaptation`), so listing it as a likely
  // duplicate would only be noise on a screen whose whole job is deciding what to merge.
  const raw = novelMismatch ? 0 : reasons.reduce((total, r) => total + r.points, 0)
  return { score: Math.max(0, Math.min(100, raw)), reasons }
}

interface RawPair extends Record<string, unknown> {
  a_id: number
  b_id: number
  name_sim: number | string | null
  a_name: string | null
  b_name: string | null
  exact_alias: boolean
  exact_alias_a: string | null
  exact_alias_b: string | null
  slug_root: string | null
}

interface RawSide extends Record<string, unknown> {
  id: number
  slug: string
  title: string
  type: SeriesType
  state: string
  chapter_count: number
  bookmark_count: number
  view_count: number | string
  rating_count: number
  cover_key: string | null
  cover_color: string | null
  released_year: number | null
  created_at: Date
  alt_titles: string[] | null
  genres: string[] | null
  people: string[] | null
}

/**
 * Candidate pairs, best first. One query generates candidates, one fetches both sides, one
 * gathers chapter overlap; the scoring is `scorePair` above, in TypeScript, so it stays
 * testable and so the screen can show the same breakdown the ranking used.
 */
export const findDuplicateSeries = async (
  db: Db,
  opts: DuplicateOptions = {},
): Promise<DuplicateCandidate[]> => {
  const threshold = opts.threshold ?? DEFAULT_NAME_THRESHOLD
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE
  const limit = Math.min(200, Math.max(1, opts.limit ?? DEFAULT_LIMIT))
  const only = opts.seriesId ?? null

  // `set_limit` scopes the `%` operator for this session; the probes below rely on it so the
  // GIN indexes answer them instead of a sequential scan with a `similarity()` filter.
  await db.execute(sql`select set_limit(${threshold})`)

  const pairs = await executeRows<RawPair>(
    db,
    sql`
      with live as (
        select id, slug::text as slug, title from series where deleted_at is null
      ),
      probe as (
        -- primary title ↔ primary title
        select least(a.id, b.id) as a_id, greatest(a.id, b.id) as b_id,
               case when a.id < b.id then a.title else b.title end as a_name,
               case when a.id < b.id then b.title else a.title end as b_name,
               similarity(a.title, b.title) as sim
        from live a
        cross join lateral (
          select s.id, s.title from series s
          where s.deleted_at is null and s.id <> a.id and s.title % a.title
          order by similarity(s.title, a.title) desc
          limit 12
        ) b
        union all
        -- primary title ↔ alternative title
        select least(a.id, t.series_id), greatest(a.id, t.series_id),
               case when a.id < t.series_id then a.title else t.title end,
               case when a.id < t.series_id then t.title else a.title end,
               similarity(a.title, t.title)
        from live a
        cross join lateral (
          select st.series_id, st.title from series_titles st
          join series s2 on s2.id = st.series_id and s2.deleted_at is null
          where st.series_id <> a.id and st.title % a.title
          order by similarity(st.title, a.title) desc
          limit 12
        ) t
        union all
        -- alternative title ↔ alternative title
        select least(x.series_id, y.series_id), greatest(x.series_id, y.series_id),
               case when x.series_id < y.series_id then x.title else y.title end,
               case when x.series_id < y.series_id then y.title else x.title end,
               similarity(x.title, y.title)
        from (
          select st.series_id, st.title from series_titles st
          join series s3 on s3.id = st.series_id and s3.deleted_at is null
        ) x
        cross join lateral (
          select st2.series_id, st2.title from series_titles st2
          join series s4 on s4.id = st2.series_id and s4.deleted_at is null
          where st2.series_id <> x.series_id and st2.title % x.title
          order by similarity(st2.title, x.title) desc
          limit 12
        ) y
      ),
      -- Every name on each side, normalised, for the exact-alias and slug-root passes.
      names as (
        select id as series_id, title, ${NORM('title')} as key from live
        union all
        select st.series_id, st.title, ${NORM('st.title')}
        from series_titles st join live l on l.id = st.series_id
      ),
      alias_pairs as (
        select least(n1.series_id, n2.series_id) as a_id,
               greatest(n1.series_id, n2.series_id) as b_id,
               case when n1.series_id < n2.series_id then n1.title else n2.title end as a_name,
               case when n1.series_id < n2.series_id then n2.title else n1.title end as b_name
        from names n1
        join names n2 on n2.key = n1.key and n2.series_id > n1.series_id
        where length(n1.key) >= 4
      ),
      slug_pairs as (
        select least(s1.id, s2.id) as a_id, greatest(s1.id, s2.id) as b_id, s1.root
        from (select id, ${SLUG_ROOT} as root from series where deleted_at is null) s1
        join (select id, ${SLUG_ROOT} as root from series where deleted_at is null) s2
          on s2.root = s1.root and s2.id > s1.id
        where length(s1.root) >= 4
      ),
      merged as (
        select a_id, b_id, max(sim) as sim from probe group by a_id, b_id
        union
        select a_id, b_id, 1.0 from alias_pairs
        union
        select a_id, b_id, 0.0 from slug_pairs
      ),
      candidates as (
        select m.a_id, m.b_id, max(m.sim) as sim from merged m group by m.a_id, m.b_id
      )
      select c.a_id, c.b_id,
             coalesce(p.sim, 0) as name_sim,
             p.a_name, p.b_name,
             (al.a_id is not null) as exact_alias,
             al.a_name as exact_alias_a, al.b_name as exact_alias_b,
             sl.root as slug_root
      from candidates c
      left join lateral (
        select pr.a_name, pr.b_name, pr.sim from probe pr
        where pr.a_id = c.a_id and pr.b_id = c.b_id
        order by pr.sim desc limit 1
      ) p on true
      left join lateral (
        select ap.a_id, ap.a_name, ap.b_name from alias_pairs ap
        where ap.a_id = c.a_id and ap.b_id = c.b_id limit 1
      ) al on true
      left join lateral (
        select sp.root from slug_pairs sp where sp.a_id = c.a_id and sp.b_id = c.b_id limit 1
      ) sl on true
      where ${only === null ? sql`true` : sql`(c.a_id = ${only} or c.b_id = ${only})`}
      order by coalesce(p.sim, 0) desc, c.a_id, c.b_id
      limit 400`,
  )

  if (pairs.length === 0) return []

  const ids = [...new Set(pairs.flatMap((p) => [Number(p.a_id), Number(p.b_id)]))]
  const sides = await executeRows<RawSide>(
    db,
    sql`
      select s.id, s.slug::text as slug, s.title, s.type::text as type, s.state::text as state,
             s.chapter_count, s.bookmark_count, s.view_count, s.rating_count,
             s.cover_key, s.cover_color, s.released_year, s.created_at,
             coalesce((select array_agg(st.title order by st.id) from series_titles st where st.series_id = s.id), '{}') as alt_titles,
             coalesce((select array_agg(g.name order by g.name) from series_genres sg join genres g on g.id = sg.genre_id where sg.series_id = s.id), '{}') as genres,
             coalesce((select array_agg(distinct pe.name) from series_people sp join people pe on pe.id = sp.person_id where sp.series_id = s.id), '{}') as people
      from series s
      where s.id in ${sql.raw(`(${ids.join(',')})`)}`,
  )
  const byId = new Map(sides.map((s) => [Number(s.id), s]))

  const overlap = await executeRows<{ a_id: number; b_id: number; numbers: string[] }>(
    db,
    sql`
      select p.a_id, p.b_id,
             coalesce(array_agg(distinct ca.number::text), '{}') as numbers
      from (values ${sql.join(
        pairs.map((p) => sql`(${Number(p.a_id)}::bigint, ${Number(p.b_id)}::bigint)`),
        sql`, `,
      )}) as p(a_id, b_id)
      join chapters ca on ca.series_id = p.a_id and ca.deleted_at is null
      join chapters cb on cb.series_id = p.b_id and cb.number = ca.number and cb.deleted_at is null
      group by p.a_id, p.b_id`,
  )
  const overlapBy = new Map(
    overlap.map((o) => [
      `${Number(o.a_id)}:${Number(o.b_id)}`,
      (o.numbers ?? []).map(Number).sort((x, y) => x - y),
    ]),
  )

  const toSide = (raw: RawSide): DuplicateSide => ({
    id: Number(raw.id),
    slug: raw.slug,
    title: raw.title,
    type: raw.type,
    state: raw.state,
    chapterCount: Number(raw.chapter_count),
    bookmarkCount: Number(raw.bookmark_count),
    viewCount: Number(raw.view_count),
    ratingCount: Number(raw.rating_count),
    coverKey: raw.cover_key,
    coverColor: raw.cover_color,
    createdAt: raw.created_at instanceof Date ? raw.created_at : new Date(String(raw.created_at)),
    altTitles: raw.alt_titles ?? [],
  })

  const out: DuplicateCandidate[] = []
  for (const p of pairs) {
    const rawA = byId.get(Number(p.a_id))
    const rawB = byId.get(Number(p.b_id))
    if (!rawA || !rawB) continue
    const sharedGenres = (rawA.genres ?? []).filter((g) => (rawB.genres ?? []).includes(g))
    const sharedPeople = (rawA.people ?? []).filter((n) => (rawB.people ?? []).includes(n))
    const nameSim = Number(p.name_sim ?? 0)
    const { score, reasons } = scorePair({
      nameSim,
      aName: p.a_name,
      bName: p.b_name,
      exactAlias: p.exact_alias === true,
      exactAliasA: p.exact_alias_a,
      exactAliasB: p.exact_alias_b,
      slugRoot: p.slug_root,
      sharedPeople,
      sharedGenres,
      aType: rawA.type,
      bType: rawB.type,
      aYear: rawA.released_year === null ? null : Number(rawA.released_year),
      bYear: rawB.released_year === null ? null : Number(rawB.released_year),
      aGenreCount: (rawA.genres ?? []).length,
      bGenreCount: (rawB.genres ?? []).length,
    })
    if (score < minScore) continue
    // The side with more reader investment leads: it is the one a merge normally keeps.
    const weight = (s: RawSide) =>
      Number(s.bookmark_count) * 10 + Number(s.rating_count) * 5 + Number(s.chapter_count)
    const [a, b] = weight(rawA) >= weight(rawB) ? [rawA, rawB] : [rawB, rawA]
    out.push({
      a: toSide(a),
      b: toSide(b),
      score,
      reasons: reasons.sort((x, y) => y.points - x.points),
      bestMatch:
        nameSim > 0 && p.a_name && p.b_name
          ? { a: p.a_name, b: p.b_name, similarity: nameSim }
          : null,
      overlappingChapters: overlapBy.get(`${Number(p.a_id)}:${Number(p.b_id)}`) ?? [],
    })
  }
  return out.sort((x, y) => y.score - x.score || x.a.id - y.a.id).slice(0, limit)
}
