-- `api_keys` comes back, with the auth that opens it.
--
-- Migration 9017 dropped this table and left a note saying why: a table shaped like key auth,
-- with nothing that verifies, scopes or revokes, is an invitation to write half of an auth
-- path against it. It said the table returns "in the same change as the middleware that
-- checks it". This is that change — `apps/web/lib/auth/api-keys.ts` and the bearer branch in
-- `withPermission`, plus Admin -> System -> Remote to issue and revoke.
--
-- The shape follows the one rule that makes this safe to reason about: **a key authenticates
-- as a user**. `user_id` is who the key acts as, so `can()` from @palscans/core remains the
-- only thing that decides access and there is no second, parallel permission model to keep in
-- step. Issuing a limited key means pointing it at a limited account, not inventing scopes.
--
-- Only the hash is stored, exactly like `sessions.secret_hash`: the plaintext is shown once at
-- creation and is unrecoverable afterwards. `prefix` is the non-secret half, so a key can be
-- found for comparison without scanning every row and so the UI can show which key is which.
CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
  "name" text NOT NULL,
  -- The lookup half. Unique so verification is one indexed read, never a table scan.
  "prefix" text NOT NULL,
  -- sha256 of the secret half. Compared in constant time (lib/auth/api-keys.ts).
  "secret_hash" bytea NOT NULL,
  -- Who the key acts as. Deleting that account takes its keys with it, which is the
  -- behaviour you want: an automation account that is removed must stop working.
  "user_id" bigint NOT NULL,
  "created_by" bigint,
  "last_used_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  -- Revoked, never deleted: a key that did something in the audit log should still be
  -- nameable afterwards.
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "api_keys_prefix_unique" UNIQUE("prefix")
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
-- The panel lists live keys first; the partial index is what keeps that cheap once revoked
-- rows outnumber live ones.
CREATE INDEX IF NOT EXISTS "api_keys_live_idx"
  ON "api_keys" USING btree ("created_at" DESC)
  WHERE "revoked_at" IS NULL;
