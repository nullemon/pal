-- Security review round 1: cover / banner uploads are re-encoded by the worker (`series.art`)
-- before they become public; the pending originals live here until then.
-- { "cover": { key, requested_at, requested_by, error? }, "banner": { ... } }
ALTER TABLE "series" ADD COLUMN IF NOT EXISTS "art_pending" jsonb;
