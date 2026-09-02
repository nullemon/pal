-- Denormalised counters maintained by triggers (docs/02 "Counter maintenance").
-- Statement-level triggers with transition tables keep bulk inserts (seed, importer) cheap.
-- A nightly job reconciles them against the source tables and logs drift.

CREATE OR REPLACE FUNCTION series_refresh_chapter_counters(sids bigint[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE series s SET
    chapter_count = COALESCE(c.cnt, 0),
    last_chapter_at = c.last_at,
    updated_at = now()
  FROM unnest(sids) AS u(id)
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS cnt, max(published_at) AS last_at
    FROM chapters
    WHERE series_id = u.id AND state = 'published' AND deleted_at IS NULL
  ) c ON true
  WHERE s.id = u.id;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION chapters_counters_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ids bigint[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT series_id) INTO ids FROM new_rows;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT series_id) INTO ids FROM old_rows;
  ELSE
    SELECT array_agg(DISTINCT series_id) INTO ids
    FROM (SELECT series_id FROM new_rows UNION SELECT series_id FROM old_rows) x;
  END IF;
  IF ids IS NOT NULL THEN
    PERFORM series_refresh_chapter_counters(ids);
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER chapters_counters_ins AFTER INSERT ON chapters
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION chapters_counters_trigger();
--> statement-breakpoint
CREATE TRIGGER chapters_counters_upd AFTER UPDATE ON chapters
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION chapters_counters_trigger();
--> statement-breakpoint
CREATE TRIGGER chapters_counters_del AFTER DELETE ON chapters
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION chapters_counters_trigger();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION chapter_pages_count_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ids bigint[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT chapter_id) INTO ids FROM new_rows;
  ELSE
    SELECT array_agg(DISTINCT chapter_id) INTO ids FROM old_rows;
  END IF;
  IF ids IS NOT NULL THEN
    UPDATE chapters c SET page_count = (SELECT count(*) FROM chapter_pages p WHERE p.chapter_id = c.id)
    WHERE c.id = ANY(ids);
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER chapter_pages_count_ins AFTER INSERT ON chapter_pages
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION chapter_pages_count_trigger();
--> statement-breakpoint
CREATE TRIGGER chapter_pages_count_del AFTER DELETE ON chapter_pages
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION chapter_pages_count_trigger();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION bookmarks_counters_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE series SET bookmark_count = bookmark_count + 1 WHERE id = NEW.series_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE series SET bookmark_count = greatest(bookmark_count - 1, 0) WHERE id = OLD.series_id;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER bookmarks_counters AFTER INSERT OR DELETE ON bookmarks
FOR EACH ROW EXECUTE FUNCTION bookmarks_counters_trigger();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ratings_counters_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE series SET rating_sum = rating_sum + NEW.score, rating_count = rating_count + 1
    WHERE id = NEW.series_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE series SET rating_sum = rating_sum - OLD.score + NEW.score WHERE id = NEW.series_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE series SET rating_sum = greatest(rating_sum - OLD.score, 0),
                      rating_count = greatest(rating_count - 1, 0)
    WHERE id = OLD.series_id;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER ratings_counters AFTER INSERT OR UPDATE OF score OR DELETE ON ratings
FOR EACH ROW EXECUTE FUNCTION ratings_counters_trigger();
--> statement-breakpoint
-- comments.score = upvotes + 0.5 * (funny + love + surprised), rounded; reaction_counts cached
CREATE OR REPLACE FUNCTION comment_reactions_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ids bigint[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT comment_id) INTO ids FROM new_rows;
  ELSE
    SELECT array_agg(DISTINCT comment_id) INTO ids FROM old_rows;
  END IF;
  IF ids IS NOT NULL THEN
    UPDATE comments c SET
      reaction_counts = COALESCE((
        SELECT jsonb_object_agg(kind, n)
        FROM (SELECT kind, count(*) AS n FROM comment_reactions r WHERE r.comment_id = c.id GROUP BY kind) k
      ), '{}'::jsonb),
      score = COALESCE((
        SELECT round(sum(CASE WHEN kind = 'up' THEN 1 WHEN kind IN ('funny', 'love', 'surprised') THEN 0.5 ELSE 0 END))::int
        FROM comment_reactions r WHERE r.comment_id = c.id
      ), 0)
    WHERE c.id = ANY(ids);
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER comment_reactions_counters_ins AFTER INSERT ON comment_reactions
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION comment_reactions_trigger();
--> statement-breakpoint
CREATE TRIGGER comment_reactions_counters_del AFTER DELETE ON comment_reactions
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION comment_reactions_trigger();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION comment_replies_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ids bigint[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT parent_id) INTO ids FROM new_rows WHERE parent_id IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT parent_id) INTO ids FROM old_rows WHERE parent_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT parent_id) INTO ids
    FROM (SELECT parent_id FROM new_rows UNION SELECT parent_id FROM old_rows) x
    WHERE parent_id IS NOT NULL;
  END IF;
  IF ids IS NOT NULL THEN
    UPDATE comments p SET reply_count = (
      SELECT count(*) FROM comments r
      WHERE r.parent_id = p.id AND r.deleted_at IS NULL AND r.status = 'published'
    ) WHERE p.id = ANY(ids);
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER comment_replies_counters_ins AFTER INSERT ON comments
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION comment_replies_trigger();
--> statement-breakpoint
CREATE TRIGGER comment_replies_counters_upd AFTER UPDATE ON comments
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION comment_replies_trigger();
--> statement-breakpoint
CREATE TRIGGER comment_replies_counters_del AFTER DELETE ON comments
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION comment_replies_trigger();
