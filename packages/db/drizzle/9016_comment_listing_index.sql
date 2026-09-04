-- docs/14 §1 + §9 — comment listing served from an index instead of a table scan.
--
-- Two things kept every `GET /api/comments` on a sequential scan of `comments`:
--
--   1. the visibility rule `deleted_at IS NULL OR reply_count > 0` (a deleted comment that
--      still has replies stays as a "[deleted]" stub so the thread survives). The OR
--      disqualified every partial index, which are all `WHERE deleted_at IS NULL`.
--   2. the default "best" order — `score * power(0.5, age / 86400)` — is recomputed per row
--      against `now()`, so no index could ever hold it.
--
-- `visible` restates rule 1 as one stored column a partial index can be predicated on.
--
-- `hot` restates rule 2 as a value that does not depend on `now()`. Ordering by the decayed
-- score is *time invariant*: decayed = score * 0.5^((now - created)/86400) = K(now) * score *
-- 2^(created/86400) with K(now) > 0 the same for every row, so multiplying it out never
-- reorders two comments. Taking logs of the surviving factor gives, for score > 0,
-- `ln(score) + days_since_epoch * ln 2`, which is a fixed number per row that only moves when
-- the score moves. Negative scores decay towards zero from below, so they keep the mirror
-- image of that value, and score = 0 (decayed to exactly 0 forever) sits between them —
-- positives land near +14 000, negatives near −14 000, so the three classes never cross.
--
-- Both are GENERATED ... STORED rather than columns a job refreshes: the value is a function
-- of the row, so it cannot drift from the row, and `0002_counters.sql` already updates
-- `score` and `reply_count` in place. Adding a stored generated column rewrites the table,
-- so this migration takes an ACCESS EXCLUSIVE lock for the length of the rewrite.
ALTER TABLE "comments"
  ADD COLUMN IF NOT EXISTS "visible" boolean
    GENERATED ALWAYS AS ("deleted_at" IS NULL OR "reply_count" > 0) STORED NOT NULL;
--> statement-breakpoint
ALTER TABLE "comments"
  ADD COLUMN IF NOT EXISTS "hot" double precision
    GENERATED ALWAYS AS (
      CASE
        WHEN "score" > 0 THEN
          ln("score"::double precision)
            + extract(epoch from ("created_at" - timestamptz '1970-01-01 00:00:00+00')) / 86400.0 * ln(2.0)
        WHEN "score" < 0 THEN
          -(ln((-"score")::double precision)
            + extract(epoch from ("created_at" - timestamptz '1970-01-01 00:00:00+00')) / 86400.0 * ln(2.0))
        ELSE 0
      END
    ) STORED NOT NULL;
--> statement-breakpoint
-- The thread listing: one index per target kind, holding the whole default order. `status`
-- and `user_id` trail the sort keys so the `count(*)` beside every page is an index-only
-- scan; they never affect the ordering because `id` above them is unique.
CREATE INDEX IF NOT EXISTS "comments_chapter_thread_idx" ON "comments" USING btree (
  "chapter_id","is_pinned" DESC,"hot" DESC,"created_at" DESC,"id" DESC,"status","user_id"
) WHERE "comments"."parent_id" IS NULL AND "comments"."chapter_id" IS NOT NULL AND "comments"."visible";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_series_thread_idx" ON "comments" USING btree (
  "series_id","is_pinned" DESC,"hot" DESC,"created_at" DESC,"id" DESC,"status","user_id"
) WHERE "comments"."parent_id" IS NULL AND "comments"."chapter_id" IS NULL AND "comments"."series_id" IS NOT NULL AND "comments"."visible";--> statement-breakpoint
-- Newest / oldest ask for the same rows in `created_at` order.
CREATE INDEX IF NOT EXISTS "comments_chapter_recent_idx" ON "comments" USING btree (
  "chapter_id","is_pinned" DESC,"created_at" DESC,"id" DESC,"status","user_id"
) WHERE "comments"."parent_id" IS NULL AND "comments"."chapter_id" IS NOT NULL AND "comments"."visible";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_series_recent_idx" ON "comments" USING btree (
  "series_id","is_pinned" DESC,"created_at" DESC,"id" DESC,"status","user_id"
) WHERE "comments"."parent_id" IS NULL AND "comments"."chapter_id" IS NULL AND "comments"."series_id" IS NOT NULL AND "comments"."visible";--> statement-breakpoint
-- Replies (previews and "show all N"), same visibility rule.
CREATE INDEX IF NOT EXISTS "comments_parent_visible_idx" ON "comments" USING btree (
  "parent_id","created_at","id","status"
) WHERE "comments"."parent_id" IS NOT NULL AND "comments"."visible";
