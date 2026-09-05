-- H · Genre management (docs/04 "Content", docs/12 §7 "slugs never break links").
--
-- `genres` was written as a fixed list: a slug, a name, a kind and the SEO fields the
-- /genres/<slug> page renders. Nothing about it could be operated. There was no order to
-- change, no way to retire a duplicate, and no record of a rename — which is why the only
-- way to fix a typo was UPDATE ... WHERE slug = '...' against production.
--
-- Three columns make the table operable, and each one exists because of a specific failure:
--
--   * `position` — the public /genres listing and the browse filter panel ordered by name,
--     so "Action" and "Adult" sat next to each other above everything readers actually use.
--     Ordering is per `kind` (genre · theme · format), which is how both surfaces already
--     group. Backfilled from the current alphabetical order below, so the first render
--     after this migration is byte-identical to the last one before it.
--   * `deleted_at` — a genre in use cannot be hard-deleted without taking its
--     `series_genres` rows with it (the FK cascades), which silently detaches every series
--     that carried the tag with no way back. Soft delete keeps the join rows, so a genre
--     retired by mistake is restored with its attachments intact.
--   * `merged_into_id` — when two rows are the same genre under two names, one is folded
--     into the other. The winner is recorded on the loser so the retired row still explains
--     itself in the admin list, and so the audit entry is not the only trace.
--
-- The URL side is not new machinery: `slug_history` already carries an `entity_type` of
-- 'genre' and `apps/web/lib/seo/{snapshot,proxy}.ts` already joins and serves it (a rename
-- 301s /genres/<old> and every path under it). What was missing was anything that wrote a
-- row into it — see `renameGenre` / `mergeGenres` in packages/db/src/queries/genres.ts.
ALTER TABLE "genres" ADD COLUMN IF NOT EXISTS "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "genres" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "genres" ADD COLUMN IF NOT EXISTS "merged_into_id" bigint;--> statement-breakpoint

-- `ADD CONSTRAINT IF NOT EXISTS` does not exist in Postgres; the catalogue probe is the
-- idempotent form. ON DELETE SET NULL rather than CASCADE: the winner of a merge is itself
-- soft-deleted, never removed, but if a row ever did go the loser must not go with it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'genres_merged_into_id_fkey') THEN
    ALTER TABLE "genres"
      ADD CONSTRAINT "genres_merged_into_id_fkey"
      FOREIGN KEY ("merged_into_id") REFERENCES "genres"("id") ON DELETE SET NULL;
  END IF;
END $$;--> statement-breakpoint

-- Seed the order from what is on screen today. Guarded on "every position is still 0", so
-- re-applying the migration after an operator has reordered anything changes nothing.
UPDATE "genres" g
SET "position" = r.rn
FROM (
  SELECT "id", (row_number() OVER (PARTITION BY "kind" ORDER BY "name", "id"))::int AS rn
  FROM "genres"
) r
WHERE r."id" = g."id"
  AND NOT EXISTS (SELECT 1 FROM "genres" x WHERE x."position" <> 0);--> statement-breakpoint

-- The listing order for /genres, the browse filter panel and the admin screen, with the
-- retired rows excluded by the same index that sorts the live ones.
CREATE INDEX IF NOT EXISTS "genres_kind_position_idx"
  ON "genres" USING btree ("kind","position","name") WHERE "deleted_at" IS NULL;
