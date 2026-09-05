import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db, type DbHandle, executeRows } from '../client.js'
import { runMigrations } from '../migrate.js'
import { mergeSeries, previewMerge, tombstoneSlugFor } from './merge.js'

/**
 * The merge, against a real Postgres (PGlite). Everything asserted here is a property of the
 * SQL and of the schema's own constraints — unique keys, the counter triggers from migration
 * 0002, the partitioned `view_events` — so a mocked database would prove nothing.
 *
 * The load-bearing test is `leaves nothing behind`: it walks `information_schema` for every
 * column in the database that points at a series and asserts the loser has no rows left in
 * any of them. A table added later that forgets to join the merge fails this test rather
 * than silently orphaning its rows.
 */

let dir: string
let handle: DbHandle
let db: Db

const ids = {
  reader: 0,
  reader2: 0,
  mod: 0,
  winner: 0,
  loser: 0,
  other: 0,
  genreA: 0,
  genreB: 0,
  person: 0,
  group: 0,
}

const scalar = async (query: ReturnType<typeof sql>): Promise<number> => {
  const [row] = await executeRows<{ n: number }>(db, query)
  return Number(row?.n ?? 0)
}

const newSeries = async (slug: string, title: string, extra: Record<string, unknown> = {}) => {
  const type = (extra.type as string) ?? 'manhwa'
  const state = (extra.state as string) ?? 'published'
  const [row] = await executeRows<{ id: number }>(
    db,
    sql`insert into series (slug, title, type, state, released_year)
        values (${slug}, ${title}, ${sql.raw(`'${type}'`)}, ${sql.raw(`'${state}'`)}, 2021)
        returning id`,
  )
  return Number(row?.id ?? 0)
}

const addChapter = async (seriesId: number, number: number, pageKeys: string[]) => {
  const [row] = await executeRows<{ id: number }>(
    db,
    sql`insert into chapters (series_id, number, state, published_at)
        values (${seriesId}, ${number}, 'published', now()) returning id`,
  )
  const id = Number(row?.id ?? 0)
  for (const [idx, key] of pageKeys.entries())
    await db.execute(
      sql`insert into chapter_pages (chapter_id, idx, key, width, height, bytes)
          values (${id}, ${idx}, ${key}, 800, 1200, 1000)`,
    )
  return id
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-merge-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  db = handle.db
  await runMigrations(handle)
})

afterAll(async () => {
  await handle.close()
  await rm(dir, { recursive: true, force: true })
})

/**
 * A fixture with at least one row in every table that points at a series, and a conflict in
 * every table that can have one (the same reader on both sides, the same day of stats, the
 * same genre, the same list). A merge that only handles the easy half fails here.
 */
beforeEach(async () => {
  for (const table of [
    'audit_log',
    'view_events',
    'chapter_stats_daily',
    'series_stats_daily',
    'chapter_reads',
    'reading_progress',
    'reading_list_items',
    'reading_lists',
    'comments',
    'bookmarks',
    'ratings',
    'chapter_groups',
    'chapter_pages',
    'chapters',
    'series_titles',
    'series_genres',
    'series_people',
    'geo_restrictions',
    'takedowns',
    'reports',
    'import_map',
    'import_runs',
    'slug_history',
    'redirects',
    'groups',
    'people',
    'genres',
  ])
    await db.execute(sql`delete from ${sql.raw(table)}`)
  await db.execute(sql`update series set linked_series_id = null`)
  await db.execute(sql`delete from series`)
  await db.execute(sql`delete from users`)

  const people = await executeRows<{ id: number; username: string }>(
    db,
    sql`insert into users (email, username, role) values
        ('reader@example.com', 'reader', 'user'),
        ('reader2@example.com', 'reader2', 'user'),
        ('mod@example.com', 'mod', 'moderator')
        returning id, username`,
  )
  ids.reader = Number(people.find((p) => p.username === 'reader')?.id)
  ids.reader2 = Number(people.find((p) => p.username === 'reader2')?.id)
  ids.mod = Number(people.find((p) => p.username === 'mod')?.id)

  ids.winner = await newSeries('solo-leveling', 'Solo Leveling')
  ids.loser = await newSeries('solo-leveling-2', 'Solo Leveling')
  ids.other = await newSeries('third-wheel', 'Third Wheel')

  const genres = await executeRows<{ id: number; slug: string }>(
    db,
    sql`insert into genres (slug, name) values ('action', 'Action'), ('drama', 'Drama') returning id, slug`,
  )
  ids.genreA = Number(genres.find((g) => g.slug === 'action')?.id)
  ids.genreB = Number(genres.find((g) => g.slug === 'drama')?.id)
  const [person] = await executeRows<{ id: number }>(
    db,
    sql`insert into people (slug, name) values ('chugong', 'Chugong') returning id`,
  )
  ids.person = Number(person?.id)
  const [group] = await executeRows<{ id: number }>(
    db,
    sql`insert into groups (slug, name) values ('scans', 'Scans') returning id`,
  )
  ids.group = Number(group?.id)

  // chapters: 1 and 2 unique to the winner, 3 and 4 unique to the loser
  await addChapter(ids.winner, 1, ['w/1a', 'w/1b'])
  await addChapter(ids.winner, 2, ['w/2a'])
  const loserThree = await addChapter(ids.loser, 3, ['l/3a'])
  await addChapter(ids.loser, 4, ['l/4a'])
  await db.execute(
    sql`insert into chapter_groups (chapter_id, group_id) values (${loserThree}, ${ids.group})`,
  )

  // bookmarks: reader has both (conflict), reader2 only the loser (a clean move)
  await db.execute(sql`insert into bookmarks (user_id, series_id, status) values
      (${ids.reader}, ${ids.winner}, 'reading'),
      (${ids.reader}, ${ids.loser}, 'completed'),
      (${ids.reader2}, ${ids.loser}, 'planned')`)
  await db.execute(sql`insert into ratings (user_id, series_id, score) values
      (${ids.reader}, ${ids.winner}, 8),
      (${ids.reader}, ${ids.loser}, 4),
      (${ids.reader2}, ${ids.loser}, 10)`)
  await db.execute(sql`insert into reading_progress (user_id, series_id, chapter_id, page_idx, read_at)
      select ${ids.reader}, ${ids.winner}, id, 1, now() - interval '2 days' from chapters where series_id = ${ids.winner} and number = 1`)
  await db.execute(sql`insert into reading_progress (user_id, series_id, chapter_id, page_idx, read_at)
      values (${ids.reader}, ${ids.loser}, ${loserThree}, 3, now())`)
  await db.execute(sql`insert into reading_progress (user_id, series_id, chapter_id, page_idx, read_at)
      values (${ids.reader2}, ${ids.loser}, ${loserThree}, 0, now())`)

  await db.execute(sql`insert into comments (user_id, series_id, body) values
      (${ids.reader}, ${ids.loser}, '{"type":"doc","version":1,"children":[]}'::jsonb),
      (${ids.reader2}, ${ids.loser}, '{"type":"doc","version":1,"children":[]}'::jsonb)`)
  await db.execute(sql`insert into comments (user_id, series_id, chapter_id, body)
      values (${ids.reader}, ${ids.loser}, ${loserThree}, '{"type":"doc","version":1,"children":[]}'::jsonb)`)

  const lists = await executeRows<{ id: number }>(
    db,
    sql`insert into reading_lists (user_id, name, slug) values (${ids.reader}, 'Favourites', 'favourites') returning id`,
  )
  const listId = Number(lists[0]?.id)
  await db.execute(sql`insert into reading_list_items (list_id, series_id, position) values
      (${listId}, ${ids.winner}, 0), (${listId}, ${ids.other}, 1), (${listId}, ${ids.loser}, 2)`)

  await db.execute(sql`insert into series_stats_daily (series_id, bucket, views) values
      (${ids.winner}, current_date, 10),
      (${ids.loser}, current_date, 7),
      (${ids.loser}, current_date - 1, 4)`)
  await db.execute(sql`insert into view_events (series_id, chapter_id, bucket, viewer_key) values
      (${ids.winner}, 0, current_date, '\\x01'::bytea),
      (${ids.loser}, 0, current_date, '\\x01'::bytea),
      (${ids.loser}, 0, current_date, '\\x02'::bytea)`)

  await db.execute(sql`insert into series_genres (series_id, genre_id) values
      (${ids.winner}, ${ids.genreA}), (${ids.loser}, ${ids.genreA}), (${ids.loser}, ${ids.genreB})`)
  await db.execute(sql`insert into series_people (series_id, person_id, credit) values
      (${ids.loser}, ${ids.person}, 'author')`)
  await db.execute(sql`insert into series_titles (series_id, title) values
      (${ids.winner}, 'Only I Level Up'), (${ids.loser}, 'Na Honjaman Level Up'), (${ids.loser}, 'Only I Level Up')`)
  await db.execute(sql`insert into geo_restrictions (series_id, country, mode) values
      (${ids.loser}, 'KR', 'block')`)
  await db.execute(sql`insert into takedowns (series_id, claimant, claimant_email, notice_body)
      values (${ids.loser}, 'Rights Co', 'legal@example.com', 'notice')`)
  await db.execute(sql`insert into reports (kind, target_type, target_id, reason)
      values ('series_data', 'series', ${ids.loser}, 'wrong cover')`)
  await db.execute(
    sql`insert into import_map (kind, legacy_id, target_id) values ('series', 991, ${ids.loser})`,
  )
  await db.execute(sql`insert into slug_history (entity_type, old_slug, entity_id)
      values ('series', 'solo-leveling-old', ${ids.loser})`)
  await db.execute(
    sql`insert into redirects (from_path, to_path) values ('/old/solo', '/series/solo-leveling-2')`,
  )
  await db.execute(sql`update series set linked_series_id = ${ids.loser} where id = ${ids.other}`)
})

describe('previewMerge', () => {
  it('counts what moves and what folds into a row the winner already has', async () => {
    const preview = await previewMerge(db, ids.winner, ids.loser)
    const by = Object.fromEntries(preview.moves.map((m) => [m.key, m]))
    expect(preview.refusals).toEqual([])
    expect(by.chapters).toEqual({ key: 'chapters', move: 2, merge: 0 })
    expect(by.bookmarks).toEqual({ key: 'bookmarks', move: 1, merge: 1 })
    expect(by.ratings).toEqual({ key: 'ratings', move: 1, merge: 1 })
    expect(by.reading_progress).toEqual({ key: 'reading_progress', move: 1, merge: 1 })
    expect(by.reading_list_items).toEqual({ key: 'reading_list_items', move: 0, merge: 1 })
    expect(by.comments).toEqual({ key: 'comments', move: 3, merge: 0 })
    expect(by.series_stats_daily).toEqual({ key: 'series_stats_daily', move: 1, merge: 1 })
    expect(by.view_events).toEqual({ key: 'view_events', move: 1, merge: 1 })
    expect(by.series_genres).toEqual({ key: 'series_genres', move: 1, merge: 1 })
    expect(by.series_titles).toEqual({ key: 'series_titles', move: 1, merge: 1 })
    expect(by.takedowns?.move).toBe(1)
    expect(by.reports?.move).toBe(1)
    expect(by.import_map?.move).toBe(1)
    expect(by.slug_history?.move).toBe(1)
    expect(by.linked_series?.move).toBe(1)
    expect(by.redirects?.move).toBe(1)
  })

  it('names the redirect it will leave behind before anything is written', async () => {
    const preview = await previewMerge(db, ids.winner, ids.loser)
    expect(preview.redirect).toEqual({
      fromPath: '/series/solo-leveling-2',
      toPath: '/series/solo-leveling',
    })
    expect(preview.tombstoneSlug).toBe(tombstoneSlugFor(ids.loser, 'solo-leveling-2'))
    expect(
      await scalar(
        sql`select count(*)::int as n from redirects where from_path = '/series/solo-leveling-2'`,
      ),
    ).toBe(0)
  })
})

describe('mergeSeries', () => {
  it('leaves nothing behind: every column in the database that points at a series is empty for the loser', async () => {
    const result = await mergeSeries(db, {
      winnerId: ids.winner,
      loserId: ids.loser,
      actorId: ids.mod,
    })
    expect(result.ok).toBe(true)

    // Every base table with a `series_id` column, read out of the catalogue rather than
    // listed by hand — a new table inherits this assertion for free.
    const tables = await executeRows<{ table_name: string }>(
      db,
      sql`select c.table_name from information_schema.columns c
          join information_schema.tables t
            on t.table_schema = c.table_schema and t.table_name = c.table_name
          where c.table_schema = 'public' and c.column_name = 'series_id'
            and t.table_type = 'BASE TABLE'
            and c.table_name not like 'view_events_%'
          order by 1`,
    )
    expect(tables.length).toBeGreaterThan(8)
    for (const { table_name } of tables) {
      const left = await scalar(
        sql`select count(*)::int as n from ${sql.raw(table_name)} where series_id = ${ids.loser}`,
      )
      expect(`${table_name}=${left}`).toBe(`${table_name}=0`)
    }
    // …and the pointers that are not called `series_id`.
    expect(
      await scalar(
        sql`select count(*)::int as n from series where linked_series_id = ${ids.loser}`,
      ),
    ).toBe(0)
    expect(
      await scalar(
        sql`select count(*)::int as n from reports where target_type = 'series' and target_id = ${ids.loser}`,
      ),
    ).toBe(0)
    expect(
      await scalar(
        sql`select count(*)::int as n from import_map where kind = 'series' and target_id = ${ids.loser}`,
      ),
    ).toBe(0)
    expect(
      await scalar(
        sql`select count(*)::int as n from slug_history where entity_type = 'series' and entity_id = ${ids.loser}`,
      ),
    ).toBe(0)
  })

  it('leaves a redirect so the loser URL keeps working, including every path under it', async () => {
    await mergeSeries(db, { winnerId: ids.winner, loserId: ids.loser, actorId: ids.mod })

    const [redirect] = await executeRows<{ to_path: string; status: number; deleted_at: unknown }>(
      db,
      sql`select to_path, status, deleted_at from redirects where from_path = '/series/solo-leveling-2'`,
    )
    expect(redirect?.to_path).toBe('/series/solo-leveling')
    expect(Number(redirect?.status)).toBe(301)
    expect(redirect?.deleted_at).toBeFalsy()

    // slug_history is what makes /series/solo-leveling-2/chapter-3 resolve, not just the
    // series page; the proxy joins it to the *current* slug of the row it points at.
    const [history] = await executeRows<{ entity_id: number }>(
      db,
      sql`select entity_id from slug_history where entity_type = 'series' and old_slug = 'solo-leveling-2'`,
    )
    expect(Number(history?.entity_id)).toBe(ids.winner)

    // An older rule that pointed at the loser is repointed rather than left to chain.
    const [chained] = await executeRows<{ to_path: string }>(
      db,
      sql`select to_path from redirects where from_path = '/old/solo'`,
    )
    expect(chained?.to_path).toBe('/series/solo-leveling')

    // The loser's own slug is retired: `deleted_at` would otherwise put `solo-leveling-2` on
    // the proxy's 410 list, which is checked before slug history.
    const [tombstone] = await executeRows<{ slug: string; state: string; deleted_at: unknown }>(
      db,
      sql`select slug::text as slug, state::text as state, deleted_at from series where id = ${ids.loser}`,
    )
    expect(tombstone?.slug).toBe(tombstoneSlugFor(ids.loser, 'solo-leveling-2'))
    expect(tombstone?.state).toBe('removed')
    expect(tombstone?.deleted_at).toBeTruthy()
  })

  it('resolves every conflict in the reader’s favour and keeps the counters honest', async () => {
    await mergeSeries(db, { winnerId: ids.winner, loserId: ids.loser, actorId: ids.mod })

    // one row per reader, the winner's kept
    const [bookmark] = await executeRows<{ status: string }>(
      db,
      sql`select status from bookmarks where user_id = ${ids.reader} and series_id = ${ids.winner}`,
    )
    expect(bookmark?.status).toBe('reading')
    expect(
      await scalar(sql`select count(*)::int as n from bookmarks where series_id = ${ids.winner}`),
    ).toBe(2)

    const [rating] = await executeRows<{ score: number }>(
      db,
      sql`select score from ratings where user_id = ${ids.reader} and series_id = ${ids.winner}`,
    )
    expect(Number(rating?.score)).toBe(8)

    // progress: the loser's row was the more recent one, so the reader is not rewound
    const [progress] = await executeRows<{ page_idx: number }>(
      db,
      sql`select page_idx from reading_progress where user_id = ${ids.reader} and series_id = ${ids.winner}`,
    )
    expect(Number(progress?.page_idx)).toBe(3)

    // stats for the same day are summed, not overwritten or duplicated
    const [today] = await executeRows<{ views: number }>(
      db,
      sql`select views from series_stats_daily where series_id = ${ids.winner} and bucket = current_date`,
    )
    expect(Number(today?.views)).toBe(17)

    // the list keeps dense positions after its duplicate entry was dropped
    const positions = await executeRows<{ position: number }>(
      db,
      sql`select position from reading_list_items order by position`,
    )
    expect(positions.map((p) => Number(p.position))).toEqual([0, 1])

    const [counters] = await executeRows<{
      chapter_count: number
      bookmark_count: number
      rating_count: number
      rating_sum: number
      view_count: number
    }>(
      db,
      sql`select chapter_count, bookmark_count, rating_count, rating_sum, view_count
          from series where id = ${ids.winner}`,
    )
    expect(Number(counters?.chapter_count)).toBe(4)
    expect(Number(counters?.bookmark_count)).toBe(2)
    expect(Number(counters?.rating_count)).toBe(2)
    expect(Number(counters?.rating_sum)).toBe(18)

    const [dead] = await executeRows<{ bookmark_count: number; rating_count: number }>(
      db,
      sql`select bookmark_count, rating_count from series where id = ${ids.loser}`,
    )
    expect(Number(dead?.bookmark_count)).toBe(0)
    expect(Number(dead?.rating_count)).toBe(0)
  })

  it('records enough in the audit log to reconstruct what happened', async () => {
    const result = await mergeSeries(db, {
      winnerId: ids.winner,
      loserId: ids.loser,
      actorId: ids.mod,
    })
    expect(result.ok).toBe(true)

    const [entry] = await executeRows<{
      action: string
      actor_id: number
      target_id: number
      after: Record<string, unknown>
    }>(db, sql`select action, actor_id, target_id, after from audit_log order by id desc limit 1`)
    expect(entry?.action).toBe('series.merge')
    expect(Number(entry?.actor_id)).toBe(ids.mod)
    expect(Number(entry?.target_id)).toBe(ids.winner)
    const after = entry?.after as {
      loserId: number
      loserSlug: string
      redirect: { fromPath: string; toPath: string }
      moves: Array<{ key: string; move: number }>
      totals: { move: number }
    }
    expect(Number(after.loserId)).toBe(ids.loser)
    expect(after.loserSlug).toBe('solo-leveling-2')
    expect(after.redirect.fromPath).toBe('/series/solo-leveling-2')
    expect(after.moves.find((m) => m.key === 'bookmarks')?.move).toBe(1)
    expect(after.totals.move).toBeGreaterThan(0)
  })

  it('keeps the loser’s title searchable as an alias of the winner', async () => {
    await db.execute(sql`update series set title = 'Na Honjaman Level Up' where id = ${ids.loser}`)
    await mergeSeries(db, { winnerId: ids.winner, loserId: ids.loser, actorId: ids.mod })
    const titles = await executeRows<{ title: string }>(
      db,
      sql`select title from series_titles where series_id = ${ids.winner} order by title`,
    )
    expect(titles.map((t) => t.title)).toContain('Na Honjaman Level Up')
    expect(titles.map((t) => t.title)).toContain('Only I Level Up')
  })
})

describe('refusals', () => {
  it('refuses overlapping chapter numbers whose pages differ, and writes nothing', async () => {
    await addChapter(ids.loser, 1, ['l/1a', 'l/1b'])
    const preview = await previewMerge(db, ids.winner, ids.loser)
    expect(preview.refusals.map((r) => r.code)).toContain('chapter_conflict')

    const result = await mergeSeries(db, {
      winnerId: ids.winner,
      loserId: ids.loser,
      actorId: ids.mod,
    })
    expect(result.ok).toBe(false)
    expect(
      await scalar(sql`select count(*)::int as n from bookmarks where series_id = ${ids.loser}`),
    ).toBe(2)
    expect(await scalar(sql`select count(*)::int as n from audit_log`)).toBe(0)
    expect(
      await scalar(
        sql`select count(*)::int as n from redirects where from_path = '/series/solo-leveling-2'`,
      ),
    ).toBe(0)
  })

  it('retires an overlapping chapter whose pages are identical, moving what hung off it', async () => {
    const dup = await addChapter(ids.loser, 2, ['w/2a'])
    await db.execute(sql`insert into comments (user_id, series_id, chapter_id, body)
        values (${ids.reader2}, ${ids.loser}, ${dup}, '{"type":"doc","version":1,"children":[]}'::jsonb)`)
    await db.execute(
      sql`insert into chapter_reads (user_id, chapter_id) values (${ids.reader}, ${dup})`,
    )

    const preview = await previewMerge(db, ids.winner, ids.loser)
    expect(preview.refusals).toEqual([])
    expect(preview.warnings.map((w) => w.code)).toContain('duplicate_chapters')

    const result = await mergeSeries(db, {
      winnerId: ids.winner,
      loserId: ids.loser,
      actorId: ids.mod,
    })
    expect(result.ok).toBe(true)

    const [winnerTwo] = await executeRows<{ id: number }>(
      db,
      sql`select id from chapters where series_id = ${ids.winner} and number = 2 and deleted_at is null`,
    )
    expect(
      await scalar(sql`select count(*)::int as n from comments where chapter_id = ${dup}`),
    ).toBe(0)
    expect(
      await scalar(
        sql`select count(*)::int as n from comments where chapter_id = ${Number(winnerTwo?.id)}`,
      ),
    ).toBe(1)
    expect(
      await scalar(sql`select count(*)::int as n from chapter_reads where chapter_id = ${dup}`),
    ).toBe(0)
    const [retired] = await executeRows<{
      state: string
      deleted_at: unknown
      series_id: number
      view_count: number
    }>(
      db,
      sql`select state::text as state, deleted_at, series_id, view_count from chapters where id = ${dup}`,
    )
    expect(retired?.state).toBe('removed')
    expect(retired?.deleted_at).toBeTruthy()
    // Its views moved to the surviving copy rather than being counted on both.
    expect(Number(retired?.view_count)).toBe(0)
    // It stays on the tombstone: the (series_id, number) unique index covers deleted rows.
    expect(Number(retired?.series_id)).toBe(ids.loser)
  })

  it('refuses while an import run is in flight', async () => {
    await db.execute(
      sql`insert into import_runs (source, status, phase) values ('legacy', 'running', 'series')`,
    )
    const result = await mergeSeries(db, {
      winnerId: ids.winner,
      loserId: ids.loser,
      actorId: ids.mod,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.refusals[0]?.code).toBe('import_in_flight')
    expect(
      await scalar(sql`select count(*)::int as n from chapters where series_id = ${ids.loser}`),
    ).toBe(2)
  })

  it('refuses a novel and its comic adaptation', async () => {
    await db.execute(sql`update series set type = 'novel' where id = ${ids.loser}`)
    const preview = await previewMerge(db, ids.winner, ids.loser)
    expect(preview.refusals.map((r) => r.code)).toContain('adaptation')
  })

  it('refuses a series merged into itself, and a soft-deleted side', async () => {
    const self = await previewMerge(db, ids.winner, ids.winner)
    expect(self.refusals.map((r) => r.code)).toContain('same_series')
    await db.execute(sql`update series set deleted_at = now() where id = ${ids.loser}`)
    const gone = await previewMerge(db, ids.winner, ids.loser)
    expect(gone.refusals.map((r) => r.code)).toContain('deleted')
  })

  it('warns when the losing side is the one readers actually use', async () => {
    await db.execute(
      sql`insert into bookmarks (user_id, series_id) values (${ids.mod}, ${ids.loser})`,
    )
    const preview = await previewMerge(db, ids.winner, ids.loser)
    expect(preview.warnings.map((w) => w.code)).toContain('direction')
  })
})
