-- `series.rating_avg` is numeric(3,1), so it can hold at most 99.9 — fine for a 1..10 score,
-- but only while rating_sum and rating_count agree. They can separate: the DELETE branch of
-- the trigger clamped each independently, and the legacy importer writes both straight from
-- WordPress meta while also importing the underlying rows. Once separated, the next rating on
-- that series throws `numeric field overflow` from inside the trigger, so POST /api/series/:id/rating
-- returns 500 for that series forever, until someone repairs the counters by hand.
--
-- Two layers. The generated column now clamps, so a drifted counter renders a wrong number
-- instead of taking the endpoint down; and the trigger keeps the sum bounded by the count so
-- they cannot separate in the first place.

ALTER TABLE "series" DROP COLUMN IF EXISTS "rating_avg";--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "rating_avg" numeric(3, 1) GENERATED ALWAYS AS (
  CASE WHEN rating_count > 0
    THEN least(round(rating_sum::numeric / rating_count, 1), 10.0)
    ELSE 0
  END
) STORED;--> statement-breakpoint

CREATE OR REPLACE FUNCTION ratings_counters_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- `rating_count` on the right-hand side is always the pre-update value, so
  -- (rating_count ± 1) * 10 is the ceiling implied by the new count and the 1..10 check.
  IF TG_OP = 'INSERT' THEN
    UPDATE series SET
      rating_sum = least(rating_sum + NEW.score, (rating_count + 1) * 10),
      rating_count = rating_count + 1
    WHERE id = NEW.series_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE series SET
      rating_sum = least(greatest(rating_sum - OLD.score + NEW.score, 0), rating_count * 10)
    WHERE id = NEW.series_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE series SET
      rating_sum = least(greatest(rating_sum - OLD.score, 0), greatest(rating_count - 1, 0) * 10),
      rating_count = greatest(rating_count - 1, 0)
    WHERE id = OLD.series_id;
  END IF;
  RETURN NULL;
END $$;
