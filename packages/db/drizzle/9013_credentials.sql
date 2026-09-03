-- Operator-supplied integration credentials, entered in the admin panel instead of the
-- deploy environment (docs/19). Values are sealed with AES-256-GCM before they land here;
-- see packages/core/src/secrets.ts. A database dump therefore does not hand over the bucket.
CREATE TABLE IF NOT EXISTS "app_credentials" (
  -- registry id, e.g. "s3.secret_access_key" (apps/web/lib/config/registry.ts)
  "key" text PRIMARY KEY NOT NULL,
  "sealed" "bytea" NOT NULL,
  -- true when the panel must never echo the value back, only report that it is set
  "is_secret" boolean DEFAULT true NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" bigint
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "app_credentials" ADD CONSTRAINT "app_credentials_updated_by_users_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
