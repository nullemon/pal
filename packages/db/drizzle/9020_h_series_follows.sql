-- H · Following a series, and per-series notification settings (docs/17 §D).
--
-- A bookmark is a *shelf* ("reading", "completed", "dropped"); a follow is a
-- *subscription* ("tell me when this updates"). Until now the new-chapter fan-out read
-- `bookmarks`, so the two were the same thing and a reader who finished a series either
-- kept the notifications or had to remove it from their library.
--
-- This table is an **override layer over bookmarks, not a replacement**. The fan-out reads
-- `series_follows` first and falls back to a bookmark with no row here as an implicit
-- follow on `all` — which is exactly what every existing bookmarker gets today. That is
-- deliberate and it is why there is **no backfill in this migration**: a backfill can only
-- ever be a snapshot, and a snapshot taken here would have quietly frozen the shelf of
-- every reader at one instant while leaving new bookmarks unsubscribed. Nobody's
-- notifications change when this migration runs.
--
-- `mode` says how loud one series may be; the reader's global `notification_prefs` matrix
-- still ANDs over it, so a channel switched off globally stays off:
--
--   all    → in-app · push · Discord · email digest
--   push   → in-app · push
--   in_app → in-app
--   digest → email digest only
--   off    → nothing (a followed-or-bookmarked series the reader has muted)
CREATE TABLE IF NOT EXISTS "series_follows" (
  "user_id" bigint NOT NULL,
  "series_id" bigint NOT NULL,
  "mode" text DEFAULT 'all' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "series_follows_user_id_series_id_pk" PRIMARY KEY("user_id","series_id"),
  CONSTRAINT "series_follows_mode_check" CHECK ("series_follows"."mode" IN ('all', 'push', 'in_app', 'digest', 'off'))
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "series_follows" ADD CONSTRAINT "series_follows_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "series_follows" ADD CONSTRAINT "series_follows_series_id_series_id_fk"
    FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
-- The fan-out's read — "who follows this series" — with muted rows kept out of the index.
CREATE INDEX IF NOT EXISTS "series_follows_series_idx" ON "series_follows" USING btree ("series_id") WHERE "series_follows"."mode" <> 'off';--> statement-breakpoint
-- `/me/notifications`: everything I follow, newest first. Muted rows are listed there too,
-- so unlike the one above this index is not partial.
CREATE INDEX IF NOT EXISTS "series_follows_user_idx" ON "series_follows" USING btree ("user_id","created_at" DESC);
