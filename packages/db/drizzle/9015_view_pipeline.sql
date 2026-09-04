-- Hand-written (docs/02 "Views and ranking"): the machinery the view pipeline needs and the
-- schema never had. Nothing here changes an existing column, so `drizzle-kit generate` still
-- reports no diff for the partitioned `view_events` (see 0003) and the snapshot is unchanged.
--
--   * chapter_stats_daily — the per-chapter twin of series_stats_daily. It exists so
--     `chapters.view_count` can be maintained the same way `series.view_count` is: by adding
--     the *delta* between the recomputed daily total and the one already applied. Without a
--     per-chapter daily record there is no way to know what has already been counted, and the
--     counter would either drift or have to be recomputed from scratch (which would wipe the
--     numbers the seeder and the legacy importer wrote).
--   * view_events_ensure_partition(s) — 0003 said "the worker must create the daily partition
--     ahead of time" and nothing did. This is that, including draining rows that already
--     landed in view_events_default for the day (creating a partition that would claim them
--     fails otherwise).
--   * view_events_drop_partitions_before — the 90-day retention 0003 promised.
--   * stats_rollup — the `stats.rollup` job's body.
--
-- All dates are UTC (`now() at time zone 'utc'`), matching the `YYYY-MM-DD` buckets the app
-- computes; the database's own timezone never enters into it.

CREATE TABLE IF NOT EXISTS "chapter_stats_daily" (
	"chapter_id" bigint NOT NULL REFERENCES "chapters"("id") ON DELETE CASCADE,
	"bucket" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "chapter_stats_daily_chapter_id_bucket_pk" PRIMARY KEY("chapter_id","bucket")
);--> statement-breakpoint
-- Popular Weekly / Monthly scan a date range across every series, so the range comes first.
CREATE INDEX IF NOT EXISTS "series_stats_daily_bucket_idx" ON "series_stats_daily" ("bucket");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chapter_stats_daily_bucket_idx" ON "chapter_stats_daily" ("bucket");--> statement-breakpoint

-- Create one daily partition of view_events, moving any rows that already landed in the
-- default partition for that day. Returns the partition name; safe to call repeatedly.
CREATE OR REPLACE FUNCTION view_events_ensure_partition(d date) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  name text := 'view_events_' || to_char(d, 'YYYYMMDD');
  stray bigint := 0;
BEGIN
  IF to_regclass('public.' || quote_ident(name)) IS NOT NULL THEN
    RETURN name;
  END IF;
  -- Everything below runs in the caller's transaction: either the day gets its partition
  -- with every row that belonged to it, or nothing changes.
  LOCK TABLE view_events_default IN ACCESS EXCLUSIVE MODE;
  SELECT count(*) INTO stray FROM view_events_default WHERE bucket = d;
  IF stray > 0 THEN
    -- `IF EXISTS` would log a notice on every call; the table only survives an aborted one.
    IF to_regclass('pg_temp._view_events_move') IS NOT NULL THEN DROP TABLE _view_events_move; END IF;
    CREATE TEMP TABLE _view_events_move ON COMMIT DROP AS
      SELECT * FROM view_events_default WHERE bucket = d;
    DELETE FROM view_events_default WHERE bucket = d;
  END IF;
  EXECUTE format(
    'CREATE TABLE %I PARTITION OF view_events FOR VALUES FROM (%L) TO (%L)', name, d, d + 1);
  IF stray > 0 THEN
    INSERT INTO view_events (series_id, chapter_id, bucket, viewer_key)
      SELECT series_id, chapter_id, bucket, viewer_key FROM _view_events_move
      ON CONFLICT DO NOTHING;
    DROP TABLE _view_events_move;
  END IF;
  RETURN name;
END $$;--> statement-breakpoint

-- Today's partition and the next `days` of them, so a view always has somewhere to land.
CREATE OR REPLACE FUNCTION view_events_ensure_partitions(from_date date, days integer)
RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE names text[] := '{}'; i integer;
BEGIN
  FOR i IN 0..greatest(0, days) LOOP
    names := names || view_events_ensure_partition(from_date + i);
  END LOOP;
  RETURN names;
END $$;--> statement-breakpoint

-- Retention (docs/02: "drops partitions older than 90 days"). Dated partitions are dropped
-- whole — no bulk DELETE, no bloat. view_events_default is never dropped, only swept: rows
-- for a day nothing created a partition for would otherwise live forever.
CREATE OR REPLACE FUNCTION view_events_drop_partitions_before(cutoff date)
RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE dropped text[] := '{}'; r record;
BEGIN
  FOR r IN
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class p ON p.oid = i.inhparent
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE p.relname = 'view_events' AND n.nspname = 'public'
      AND c.relname ~ '^view_events_[0-9]{8}$'
      AND to_date(right(c.relname, 8), 'YYYYMMDD') < cutoff
    ORDER BY c.relname
  LOOP
    EXECUTE format('DROP TABLE %I', r.name);
    dropped := dropped || r.name;
  END LOOP;
  DELETE FROM view_events_default WHERE bucket < cutoff;
  RETURN dropped;
END $$;--> statement-breakpoint

-- The `stats.rollup` job. Recompute the daily totals for [from_bucket, to_bucket] from
-- view_events and move the *difference* into the denormalised counters.
--
-- Two properties this depends on, both deliberate:
--   * Only (series, bucket) pairs that actually have events in the window are touched. A
--     bucket with no events is left exactly as it is, so the rows the seeder and the legacy
--     importer wrote are never zeroed by a rollup that finds no traffic for that day.
--   * `views` in the daily tables is the total already applied to view_count, so re-running
--     the job over the same window is a no-op: recomputed == stored, delta 0. That is what
--     makes it safe to run every couple of minutes and to overlap runs.
-- The counters are only ever moved by this function, so it does not fight the 0002 triggers
-- (which never touch view_count) or the seeder (which only sets it before any traffic).
CREATE OR REPLACE FUNCTION stats_rollup(from_bucket date, to_bucket date)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  today date := (now() at time zone 'utc')::date;
  a date := greatest(from_bucket, today - 89);   -- never recompute a bucket retention may have pruned
  b date := least(to_bucket, today);
  s_rows integer := 0; s_delta bigint := 0;
  c_rows integer := 0; c_delta bigint := 0;
BEGIN
  IF b < a THEN
    RETURN jsonb_build_object('from', a, 'to', b, 'seriesBuckets', 0, 'chapterBuckets', 0,
                              'seriesDelta', 0, 'chapterDelta', 0);
  END IF;

  WITH agg AS (
    SELECT v.series_id, v.bucket, count(*)::int AS views
    FROM view_events v
    JOIN series s ON s.id = v.series_id
    WHERE v.bucket BETWEEN a AND b
    GROUP BY 1, 2
  ), prev AS (
    SELECT series_id, bucket, views FROM series_stats_daily WHERE bucket BETWEEN a AND b
  ), changed AS (
    SELECT agg.series_id, agg.bucket, agg.views, coalesce(prev.views, 0) AS old_views
    FROM agg LEFT JOIN prev USING (series_id, bucket)
    WHERE agg.views IS DISTINCT FROM prev.views
  ), ins AS (
    INSERT INTO series_stats_daily (series_id, bucket, views)
    SELECT series_id, bucket, views FROM changed
    ON CONFLICT (series_id, bucket) DO UPDATE SET views = EXCLUDED.views
    RETURNING 1
  ), delta AS (
    SELECT series_id, sum(views - old_views)::bigint AS d FROM changed GROUP BY 1
  ), upd AS (
    UPDATE series s SET view_count = greatest(0, s.view_count + delta.d)
    FROM delta WHERE s.id = delta.series_id
    RETURNING delta.d AS d
  )
  SELECT (SELECT count(*)::int FROM changed), (SELECT coalesce(sum(d), 0)::bigint FROM upd)
  INTO s_rows, s_delta;

  WITH agg AS (
    SELECT v.chapter_id, v.bucket, count(*)::int AS views
    FROM view_events v
    JOIN chapters c ON c.id = v.chapter_id
    WHERE v.bucket BETWEEN a AND b AND v.chapter_id <> 0
    GROUP BY 1, 2
  ), prev AS (
    SELECT chapter_id, bucket, views FROM chapter_stats_daily WHERE bucket BETWEEN a AND b
  ), changed AS (
    SELECT agg.chapter_id, agg.bucket, agg.views, coalesce(prev.views, 0) AS old_views
    FROM agg LEFT JOIN prev USING (chapter_id, bucket)
    WHERE agg.views IS DISTINCT FROM prev.views
  ), ins AS (
    INSERT INTO chapter_stats_daily (chapter_id, bucket, views)
    SELECT chapter_id, bucket, views FROM changed
    ON CONFLICT (chapter_id, bucket) DO UPDATE SET views = EXCLUDED.views
    RETURNING 1
  ), delta AS (
    SELECT chapter_id, sum(views - old_views)::bigint AS d FROM changed GROUP BY 1
  ), upd AS (
    UPDATE chapters c SET view_count = greatest(0, c.view_count + delta.d)
    FROM delta WHERE c.id = delta.chapter_id
    RETURNING delta.d AS d
  )
  SELECT (SELECT count(*)::int FROM changed), (SELECT coalesce(sum(d), 0)::bigint FROM upd)
  INTO c_rows, c_delta;

  RETURN jsonb_build_object('from', a, 'to', b, 'seriesBuckets', s_rows,
                            'chapterBuckets', c_rows, 'seriesDelta', s_delta,
                            'chapterDelta', c_delta);
END $$;--> statement-breakpoint

-- A deployment that applies this migration has today and tomorrow ready before the worker
-- has run once.
SELECT view_events_ensure_partitions((now() at time zone 'utc')::date, 2);
