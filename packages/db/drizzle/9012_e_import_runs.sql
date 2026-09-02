-- E · legacy importer (docs/09, docs/17 §E): the resumable run and the legacy → local id map.
CREATE TABLE IF NOT EXISTS "import_runs" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
  -- the source label as the report shows it; any DSN password is masked before it is stored
  "source" text NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- queued | running | paused | done | failed | cancelled
  "status" text DEFAULT 'queued' NOT NULL,
  -- terms | users | series | chapters | bookmarks | comments | redirects | done
  "phase" text DEFAULT 'terms' NOT NULL,
  -- where the next batch resumes from, per phase
  "cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
  -- set by the operator; the runner checks it between batches so a stop is never a kill
  "cancel_requested" boolean DEFAULT false NOT NULL,
  "pause_requested" boolean DEFAULT false NOT NULL,
  "started_by" bigint,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "heartbeat_at" timestamp with time zone,
  "finished_at" timestamp with time zone
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_started_by_users_id_fk"
    FOREIGN KEY ("started_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_runs_started_at_idx" ON "import_runs" USING btree ("started_at" DESC);--> statement-breakpoint
-- at most one run may be live at a time: a second Start is refused, not silently interleaved
CREATE UNIQUE INDEX IF NOT EXISTS "import_runs_live_unique" ON "import_runs" USING btree ((1))
  WHERE "status" IN ('queued', 'running', 'paused');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_map" (
  -- series | chapter | user | genre | person | comment | bookmark | page
  "kind" text NOT NULL,
  "legacy_id" bigint NOT NULL,
  "target_id" bigint NOT NULL,
  -- hash of the mapped payload, so a re-run skips rows the legacy side has not changed
  "digest" text,
  "imported_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "import_map_pkey" PRIMARY KEY("kind","legacy_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_map_target_idx" ON "import_map" USING btree ("kind","target_id");
