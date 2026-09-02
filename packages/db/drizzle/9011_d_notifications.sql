-- D · Notifications (docs/17 §D): the delivery ledger every channel writes, per-user Discord
-- links, and the email-digest opt-in with its watermark.
CREATE TABLE IF NOT EXISTS "notification_deliveries" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
  "user_id" bigint,
  "notification_id" bigint,
  "kind" text NOT NULL,
  "channel" text NOT NULL,
  "status" text NOT NULL,
  "target" text,
  "detail" text,
  "dedupe_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_deliveries_created_idx" ON "notification_deliveries" USING btree ("created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_deliveries_channel_idx" ON "notification_deliveries" USING btree ("channel","status","created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_deliveries_user_idx" ON "notification_deliveries" USING btree ("user_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_deliveries_dedupe_idx" ON "notification_deliveries" USING btree ("dedupe_key");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discord_links" (
  "user_id" bigint PRIMARY KEY NOT NULL,
  "discord_id" text,
  "discord_username" text,
  "code" text,
  "code_expires_at" timestamp with time zone,
  "linked_at" timestamp with time zone,
  "roles_synced_at" timestamp with time zone,
  "synced_roles" text[] DEFAULT '{}'::text[] NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "discord_links_discord_id_unique" UNIQUE("discord_id"),
  CONSTRAINT "discord_links_code_unique" UNIQUE("code")
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "discord_links" ADD CONSTRAINT "discord_links_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discord_links_code_idx" ON "discord_links" USING btree ("code") WHERE "code" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_digest_state" (
  "user_id" bigint PRIMARY KEY NOT NULL,
  "frequency" text DEFAULT 'off' NOT NULL,
  "last_sent_at" timestamp with time zone,
  "last_cursor_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "notification_digest_state" ADD CONSTRAINT "notification_digest_state_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
