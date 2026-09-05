-- Appearance versions for Brand, Menus and Copy (docs/15 "Presets, preview, history").
--
-- `appearance_settings` was built for one document — the theme — so it carried the draft,
-- the published row and the archive for that one screen and nothing else. Brand, Menus and
-- Copy saved straight to the live `settings` rows: no draft, no preview, no history, no way
-- back from a mangled header.
--
-- One column fixes that, and deliberately no new table. Adding `appearance_settings_2` for
-- three more documents would have meant a second set of publish/revert/audit paths that
-- drift from the first the week after they are written. `scope` turns the existing table
-- into one version stream per screen, and every existing row is a theme version — which is
-- what the default says, so the published row this migration finds keeps being the published
-- theme with no backfill.
--
-- The two indexes are the invariant, not decoration:
--
--   * `..._published_idx` was UNIQUE on `(status) WHERE status = 'published'`, i.e. "one
--     published row in the table". That is now "one published row *per scope*", so Brand and
--     Copy can each have one at the same time. Dropped and recreated under the same name
--     because the columns change; both statements are guarded, so re-running is a no-op.
--   * `..._draft_idx` is new and did not exist for the theme either. One draft per scope was
--     only ever enforced by the route handler doing SELECT-then-UPDATE, which two tabs
--     saving at once can interleave into two drafts — and then "publish the draft" picks one
--     of them arbitrarily. The database is the right place for "there is one draft".
--
-- Safe to run against a table that already holds drafts for one scope; it fails loudly, and
-- correctly, only if two drafts for the same scope already exist.
ALTER TABLE "appearance_settings" ADD COLUMN IF NOT EXISTS "scope" text DEFAULT 'theme' NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "appearance_settings_published_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "appearance_settings_published_idx" ON "appearance_settings" USING btree ("scope") WHERE "appearance_settings"."status" = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "appearance_settings_draft_idx" ON "appearance_settings" USING btree ("scope") WHERE "appearance_settings"."status" = 'draft';
