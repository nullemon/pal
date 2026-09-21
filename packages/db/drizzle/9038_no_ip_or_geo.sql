-- Stop recording where people are, and who they are at the network level.
--
-- The site used to keep three kinds of location data, all of them defensible on their own
-- terms and none of them wanted here:
--
--   * `login_events` — one row per sign-in attempt, carrying the country and city
--     Cloudflare put on the request. Any account holding `user.read` could open another
--     account's history in the admin panel and read the city it signs in from. With more
--     than one admin, that is staff being able to locate each other.
--   * `ip_hash` on `sessions`, `comments`, `reports` and `audit_log` — never a raw address,
--     but an HMAC of one. IPv4 is 2^32 wide, so anyone holding the app secret can hash the
--     whole space and read every one of those columns back as a plain address. "Hashed" was
--     never the same as "unreadable" for a value this small.
--   * the geo columns themselves, which were plain text to begin with.
--
-- After this the database has nowhere to put an address or a place, which is the only
-- version of "we do not log it" that survives someone adding a write back later: there is
-- no column to write to. Page views stay — `view_events` counts a view per viewer per day,
-- and its `viewer_key` is now derived from a first-party cookie rather than an address
-- (apps/web/lib/views/record.ts).
--
-- Forward only, like every migration here. Dropping a column is not reversible and the data
-- in it is exactly what is not wanted, so that is the point rather than a caveat.
DROP TABLE IF EXISTS "login_events";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "ip_hash";--> statement-breakpoint
ALTER TABLE "comments" DROP COLUMN IF EXISTS "ip_hash";--> statement-breakpoint
ALTER TABLE "reports" DROP COLUMN IF EXISTS "ip_hash";--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN IF EXISTS "ip_hash";--> statement-breakpoint
-- What `reports.ip_hash` was actually for: telling "five readers found this chapter broken"
-- from "one reader tapped Report five times". That needs a handle on an anonymous reporter,
-- which does not have to be an address — this one is an HMAC of the random first-party
-- cookie in `apps/web/lib/visitor.ts`, so it dedupes exactly as well and locates nobody.
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "reporter_key" bytea;--> statement-breakpoint
-- The viewer keys already written were HMACs over an address; the new ones are HMACs over a
-- cookie. Past buckets are fully rolled up into `series_stats_daily` / `view_count` and are
-- read for nothing but merge dedupe, so clearing them loses no counts. `bucket` is the
-- partition key, so this prunes to whole partitions rather than scanning.
DELETE FROM "view_events" WHERE "bucket" < CURRENT_DATE;
