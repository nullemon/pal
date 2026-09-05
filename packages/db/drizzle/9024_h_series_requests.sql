-- H · Series requests (docs/13 "Discovery" — letting readers ask for what is missing).
--
-- The shape of this feature is the point of it. A plain suggestion form produces fifty rows
-- for the one title fifty people want, and the operator learns nothing: the queue is long,
-- the signal is flat, and the only way to find demand is to read all of it. So the unit here
-- is the *title*, not the message — one row per series anybody has asked for, and a vote
-- table beside it. A second person asking for something upvotes the row that exists.
--
-- Three things enforce that in the database rather than in a route handler:
--
--   * `title_key` is a generated, normalised form of the title (lower case, letters and
--     digits only) with a UNIQUE index over it. "Solo Leveling", "solo leveling" and
--     "Solo-Leveling!!" are one row, and the second submission fails on the index — the
--     dedupe cannot be lost to a race between two requests, a retry, or a second app
--     instance. Fuzzy near-misses ("Solo Levelling") are the search's job, not the index's.
--   * `series_request_votes` is keyed by `(request_id, voter_key)`. `voter_key` is an HMAC of
--     the voter's identity (account id, else client address), so one person is one vote per
--     request as a property of the primary key. Application code never has to check first.
--   * `vote_count` is denormalised and maintained by the statement-level trigger below, the
--     same way `series.chapter_count` is (migration 0002) — the board sorts by votes on
--     every load and must never count rows to do it.
--
-- Duplicates that are not the same string (an alternative title, a different romanisation)
-- are merged by staff: `merged_into_id` points the loser at the winner and the votes are
-- moved with an ON CONFLICT DO NOTHING insert, so a person who voted for both still counts
-- once on the survivor.
CREATE TABLE IF NOT EXISTS "series_requests" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
  "title" text NOT NULL,
  -- The dedupe key. Generated rather than written by the app so it cannot drift from `title`.
  "title_key" text GENERATED ALWAYS AS (regexp_replace(lower("title"), '[^a-z0-9]+', '', 'g')) STORED NOT NULL,
  "alt_titles" text[] DEFAULT '{}'::text[] NOT NULL,
  -- MangaUpdates / AniList / official page. Stored as text, validated as a URL by the API.
  "link" text,
  "type" "series_type",
  "note" text,
  -- open · planned · added · declined · exists (already on the site). Text with a CHECK
  -- rather than an enum: statuses here are workflow, and workflow gains states — a CHECK is
  -- one migration to change, an enum a column depends on is three.
  "status" text DEFAULT 'open' NOT NULL,
  -- Shown publicly under a declined row. Declining without saying why is how a board dies.
  "decline_reason" text,
  -- What fulfils the request (status 'added') or what it already was (status 'exists').
  "series_id" bigint,
  -- Set when staff merge this row into another; merged rows leave the board.
  "merged_into_id" bigint,
  -- The requester, when they were signed in — the only reason we can tell them the outcome.
  "user_id" bigint,
  -- HMAC of whoever filed it (account, else address). An anonymous submission stays
  -- attributable enough to find a flood, without an address ever reaching the table.
  "requester_key" bytea,
  "vote_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "resolved_by" bigint,
  CONSTRAINT "series_requests_title_check" CHECK (length(btrim("title")) BETWEEN 2 AND 200),
  CONSTRAINT "series_requests_status_check"
    CHECK ("status" IN ('open', 'planned', 'added', 'declined', 'exists')),
  -- "Added" and "already on the site" are the two statuses that close the loop for a reader,
  -- and both are a lie without the link. The database refuses them without one.
  CONSTRAINT "series_requests_fulfilled_check"
    CHECK ("status" NOT IN ('added', 'exists') OR "series_id" IS NOT NULL),
  CONSTRAINT "series_requests_alt_titles_check" CHECK (cardinality("alt_titles") <= 10)
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "series_requests" ADD CONSTRAINT "series_requests_series_id_series_id_fk"
    FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "series_requests" ADD CONSTRAINT "series_requests_merged_into_id_series_requests_id_fk"
    FOREIGN KEY ("merged_into_id") REFERENCES "series_requests"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "series_requests" ADD CONSTRAINT "series_requests_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "series_requests" ADD CONSTRAINT "series_requests_resolved_by_users_id_fk"
    FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
-- One row per title, forever. A merged or declined row keeps its key, so re-submitting a
-- title that was turned down lands on the row carrying the reason rather than starting the
-- same argument again in a new row.
CREATE UNIQUE INDEX IF NOT EXISTS "series_requests_title_key_uidx" ON "series_requests" USING btree ("title_key");--> statement-breakpoint
-- The board's own index: "most wanted, in this status". Merged rows are out of the index as
-- well as out of the query, so they cost nothing to keep.
CREATE INDEX IF NOT EXISTS "series_requests_board_idx" ON "series_requests" USING btree ("status","vote_count" DESC,"created_at" DESC) WHERE "series_requests"."merged_into_id" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "series_requests_newest_idx" ON "series_requests" USING btree ("created_at" DESC) WHERE "series_requests"."merged_into_id" IS NULL;--> statement-breakpoint
-- Search-before-you-post is a trigram match on the title — the same mechanism `searchSeries`
-- already uses for the catalogue (`pg_trgm`, enabled in migration 0000).
CREATE INDEX IF NOT EXISTS "series_requests_title_trgm_idx" ON "series_requests" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "series_requests_series_idx" ON "series_requests" USING btree ("series_id") WHERE "series_requests"."series_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "series_requests_user_idx" ON "series_requests" USING btree ("user_id","created_at" DESC) WHERE "series_requests"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "series_requests_merged_idx" ON "series_requests" USING btree ("merged_into_id") WHERE "series_requests"."merged_into_id" IS NOT NULL;--> statement-breakpoint

-- One vote per person per request, and the primary key is what says so.
--
-- `voter_key` is HMAC(app secret, 'rq:v1|' || identity) truncated to 16 bytes, where the
-- identity is the account id for a signed-in reader and the client address for everyone
-- else. Unlike the view pipeline's `viewer_key` there is deliberately **no day bucket** in
-- it: a key that rotated daily would hand every anonymous reader a fresh vote every morning,
-- which is the one thing this table exists to prevent.
CREATE TABLE IF NOT EXISTS "series_request_votes" (
  "request_id" bigint NOT NULL,
  "voter_key" bytea NOT NULL,
  "user_id" bigint,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "series_request_votes_request_id_voter_key_pk" PRIMARY KEY("request_id","voter_key")
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "series_request_votes" ADD CONSTRAINT "series_request_votes_request_id_series_requests_id_fk"
    FOREIGN KEY ("request_id") REFERENCES "series_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "series_request_votes" ADD CONSTRAINT "series_request_votes_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
-- The second lock on the same rule. An account's key is derived from its id, so the primary
-- key already covers the ordinary case — but a reader who voted anonymously and then signed
-- in carries two identities, and this index is what stops the account half of that from
-- voting again on a request the same person has already voted for.
CREATE UNIQUE INDEX IF NOT EXISTS "series_request_votes_user_uidx" ON "series_request_votes" USING btree ("request_id","user_id") WHERE "series_request_votes"."user_id" IS NOT NULL;--> statement-breakpoint
-- "Which of these has this viewer already voted for" — one query for a whole page.
CREATE INDEX IF NOT EXISTS "series_request_votes_voter_idx" ON "series_request_votes" USING btree ("voter_key");--> statement-breakpoint

-- The counter, maintained exactly like the ones in 0002: a statement-level trigger with
-- transition tables, so moving four hundred votes during a merge is one recount and not four
-- hundred. `updated_at` is deliberately not touched — a vote is not an edit of the request.
CREATE OR REPLACE FUNCTION series_requests_refresh_votes(ids bigint[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE series_requests r SET vote_count = COALESCE(v.cnt, 0)
  FROM unnest(ids) AS u(id)
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS cnt FROM series_request_votes WHERE request_id = u.id
  ) v ON true
  WHERE r.id = u.id AND r.vote_count IS DISTINCT FROM COALESCE(v.cnt, 0);
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION series_request_votes_counter_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ids bigint[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT request_id) INTO ids FROM new_rows;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT request_id) INTO ids FROM old_rows;
  ELSE
    SELECT array_agg(DISTINCT request_id) INTO ids
    FROM (SELECT request_id FROM new_rows UNION SELECT request_id FROM old_rows) x;
  END IF;
  IF ids IS NOT NULL THEN
    PERFORM series_requests_refresh_votes(ids);
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE OR REPLACE TRIGGER series_request_votes_counter_ins AFTER INSERT ON series_request_votes
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION series_request_votes_counter_trigger();--> statement-breakpoint
CREATE OR REPLACE TRIGGER series_request_votes_counter_upd AFTER UPDATE ON series_request_votes
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION series_request_votes_counter_trigger();--> statement-breakpoint
CREATE OR REPLACE TRIGGER series_request_votes_counter_del AFTER DELETE ON series_request_votes
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION series_request_votes_counter_trigger();
