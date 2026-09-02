-- C · accounts and access (docs/17 §C): login history and invite codes.
CREATE TABLE IF NOT EXISTS "login_events" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
  "user_id" bigint,
  "at" timestamp with time zone DEFAULT now() NOT NULL,
  "method" text NOT NULL,
  "outcome" text NOT NULL,
  "user_agent" text,
  "device" text,
  "browser" text,
  "os" text,
  "country" text,
  "city" text,
  "ip_hash" bytea,
  "session_id" uuid
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "login_events" ADD CONSTRAINT "login_events_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "login_events" ADD CONSTRAINT "login_events_session_id_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_events_user_idx" ON "login_events" USING btree ("user_id","at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_events_at_idx" ON "login_events" USING btree ("at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_events_outcome_idx" ON "login_events" USING btree ("outcome","at" DESC);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invite_codes" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
  "code" "citext" NOT NULL,
  "max_uses" integer DEFAULT 1 NOT NULL,
  "uses" integer DEFAULT 0 NOT NULL,
  "note" text,
  "expires_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "created_by" bigint,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "invite_codes_code_unique" UNIQUE("code")
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invite_codes_created_idx" ON "invite_codes" USING btree ("created_at" DESC);
