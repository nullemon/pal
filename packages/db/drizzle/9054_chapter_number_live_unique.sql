-- A chapter in the trash must not keep its number (docs/04).
--
-- The uniqueness rule was a table constraint, so it counted soft-deleted rows: delete a
-- chapter, try to upload another with the same number, and the insert is refused because a
-- row nobody can see still holds the slot. The panel said to remove it from the trash, and
-- nothing in the product can -- there is no purge, by design, because a soft delete is meant
-- to be reversible. So the advice was impossible to follow and the number was gone for good.
--
-- A partial unique index is the same rule over the rows that actually exist. Note the index
-- created beside the constraint in 9044 already had `WHERE deleted_at IS NULL`; only the
-- constraint disagreed.
ALTER TABLE chapters DROP CONSTRAINT IF EXISTS chapters_series_number_language_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS chapters_series_number_language_live_unique
  ON chapters (series_id, number, language)
  WHERE deleted_at IS NULL;
