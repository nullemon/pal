-- Social posting: the accounts we post as, and the ledger of what went out.
--
-- Two tables, for the same reason `notification_deliveries` sits beside `push_subscriptions`:
-- one holds *who we are* on each platform, the other holds *what happened*, and the second
-- has to outlive the first. Disconnect a Bluesky account and the record of what it posted
-- last month is still the only way to answer "did that chapter go out?" — so `account_id`
-- is SET NULL on delete and `platform` is denormalised onto every ledger row.
--
-- Credentials are one sealed JSON blob rather than a column per field. The six platforms
-- agree on nothing: Bluesky wants a handle and an app password, X wants four OAuth values,
-- Meta wants a page id and a long-lived token, TikTok wants a client key plus a refresh
-- token it rotates. A column per field would be a column per platform per field, mostly
-- NULL, and a migration every time a platform changes its auth. `token_expires_at` is
-- lifted out because a refresh job has to *find* the rows about to expire, which means
-- querying it, which means it cannot live inside the sealed blob.
CREATE TABLE IF NOT EXISTS "social_accounts" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
  -- bluesky | x | reddit | facebook | instagram | tiktok
  "platform" text NOT NULL,
  -- What the operator sees in the panel: @palscans, r/palscans, the Page name.
  "handle" text NOT NULL,
  -- Sealed JSON (packages/core/src/secrets.ts). Never returned to the browser.
  "credentials" bytea NOT NULL,
  -- Lifted out of the blob so the refresh sweep can query for it.
  "token_expires_at" timestamp with time zone,
  "active" boolean DEFAULT true NOT NULL,
  -- Per-platform posting options: what auto-posts, what each post carries, caps.
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_posted_at" timestamp with time zone,
  "created_by" bigint,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "social_accounts_platform_handle_unique" UNIQUE("platform","handle")
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_accounts_live_idx"
  ON "social_accounts" USING btree ("platform")
  WHERE "active";--> statement-breakpoint
-- Expiring tokens, soonest first — the refresh sweep's only query.
CREATE INDEX IF NOT EXISTS "social_accounts_expiry_idx"
  ON "social_accounts" USING btree ("token_expires_at")
  WHERE "token_expires_at" IS NOT NULL AND "active";--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "social_posts" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
  -- SET NULL, not CASCADE: disconnecting an account must not erase its history.
  "account_id" bigint,
  -- Denormalised so a row stays readable after its account is gone.
  "platform" text NOT NULL,
  -- chapter | announcement | manual
  "kind" text NOT NULL,
  -- Loose refs, like notification_deliveries: these rows are prunable and must not
  -- keep a deleted chapter's row alive, nor block its deletion.
  "chapter_id" bigint,
  "series_id" bigint,
  -- queued | sent | failed | skipped
  "status" text NOT NULL,
  -- The platform's own id for the post, and a link a human can open.
  "remote_id" text,
  "permalink" text,
  -- What we actually sent. The template can change; this is what this post said.
  "body" text,
  -- Why it failed, or why it was skipped (rate cap, account inactive).
  "detail" text,
  -- e.g. `chapter:412:bluesky`. See the unique index below.
  "dedupe_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "posted_at" timestamp with time zone
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_account_id_social_accounts_id_fk"
    FOREIGN KEY ("account_id") REFERENCES "social_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_posts_created_idx"
  ON "social_posts" USING btree ("created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_posts_platform_idx"
  ON "social_posts" USING btree ("platform","status","created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_posts_chapter_idx"
  ON "social_posts" USING btree ("chapter_id")
  WHERE "chapter_id" IS NOT NULL;--> statement-breakpoint
-- The double-post guard, and the reason this is a UNIQUE index rather than a plain one.
--
-- A duplicate notification is a wasted email. A duplicate social post is public, permanent
-- and embarrassing, and the ways to get one are ordinary: a retried job, a worker restart
-- mid-publish, an operator pressing the button twice. Enforcing it in the database means no
-- code path can produce one, including code written later by someone who has not read this.
--
-- `status <> 'failed'` is what keeps retries working: a failed attempt leaves a row, and the
-- retry must be able to insert. Excluding failures means at most one *non-failed* row per
-- key, which is exactly the property wanted — one successful post per chapter per platform,
-- however many times we had to try.
CREATE UNIQUE INDEX IF NOT EXISTS "social_posts_dedupe_unique"
  ON "social_posts" USING btree ("dedupe_key")
  WHERE "dedupe_key" IS NOT NULL AND "status" <> 'failed';
