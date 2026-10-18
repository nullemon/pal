-- The credit page (docs/03): a composed card inserted as the second page of a chapter.
--
-- Three columns, because the page is assembled from three levels. The site settings hold what
-- is the same everywhere — the roles, the handles, the footer, the overlays — and live in the
-- `settings` table like every other panel setting. What belongs on a row is what varies per
-- row, and only that:
--
--   * a series picks its own background, and optionally its own overlay, so a dark title and
--     a cute one do not have to share a look;
--   * a chapter carries its own note, falling back to the site's when it has none.
--
-- All three are nullable and all three mean "use the level above" when empty, which is what an
-- operator clearing a box expects. Nothing is backfilled: the feature is off until an overlay
-- is uploaded and it is switched on, and it applies to chapters uploaded after that.
ALTER TABLE "series" ADD COLUMN IF NOT EXISTS "credit_background_key" text;
--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN IF NOT EXISTS "credit_overlay_id" text;
--> statement-breakpoint
-- Per chapter, because the note is the one part that is actually about this chapter: a
-- translator's aside, a line from the author. Sized for a short paragraph — the card has room
-- for a few lines and a wall of text would overflow the box rather than resize it.
ALTER TABLE "chapters" ADD COLUMN IF NOT EXISTS "credit_note" text;
