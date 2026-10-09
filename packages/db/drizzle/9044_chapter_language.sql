-- Chapters get a language.
--
-- Every chapter so far is English, which is why the column defaults to `en` and is NOT NULL:
-- the backfill is the default, there is no "unknown language" state to handle later, and
-- nothing that reads a chapter has to cope with a null.
--
-- The unique constraint is the part that matters. `(series_id, number)` says a series has one
-- chapter 1, which is exactly what multi-language breaks: a German chapter 1 beside an English
-- one is the point of the feature, and the old constraint rejects it on insert. Swapping it for
-- `(series_id, number, language)` keeps the guarantee worth having — one chapter 1 *per
-- language* — while allowing the translations.
--
-- Dropping and recreating is safe here because the new constraint is strictly weaker: every row
-- that satisfied the old one satisfies this one, since they all share a language today.
ALTER TABLE "chapters" ADD COLUMN IF NOT EXISTS "language" text DEFAULT 'en' NOT NULL;
--> statement-breakpoint
ALTER TABLE "chapters" DROP CONSTRAINT IF EXISTS "chapters_series_id_number_unique";
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "chapters" ADD CONSTRAINT "chapters_series_number_language_unique"
    UNIQUE("series_id","number","language");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
-- The reader's query is "this series, this language, ordered by number" — for the chapter
-- list, and for the prev/next lookups either side of the one being read. Without the language
-- in the index those become a filter over every chapter of the series.
CREATE INDEX IF NOT EXISTS "chapters_series_language_number_idx"
  ON "chapters" USING btree ("series_id","language","number" DESC)
  WHERE "deleted_at" IS NULL;
