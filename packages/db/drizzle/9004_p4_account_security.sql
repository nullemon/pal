-- P4 · auth + account: optional TOTP, username-change cooldown, deletion grace, session last-seen.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_deletion_requested_idx" ON "users" USING btree ("deletion_requested_at") WHERE "users"."deletion_requested_at" IS NOT NULL;
