-- Manifest links a series follows, instead of being imported from once.
--
-- The import panel takes a snapshot: paste a manifest, pick chapters, done. A manifest is a
-- living file though — the group maintaining it adds a chapter the evening it releases — so a
-- catalogue built from snapshots is permanently behind the source it was built from. Keeping
-- the link lets the worker re-read it and import what appeared since.
--
-- One row per (series, url, language). The same file is legitimately followed twice when a
-- series carries two translated runs, and two files legitimately feed one series; what is
-- never wanted is the same file followed twice in the same language, which would import every
-- new chapter twice and collide on its number.
CREATE TABLE IF NOT EXISTS "manifest_sources" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
  "series_id" bigint NOT NULL REFERENCES "series"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "language" text DEFAULT 'en' NOT NULL,
  "store" text DEFAULT 'remote' NOT NULL,
  -- `ready` leaves a discovered chapter for a human to look at; `publish` puts it straight on
  -- the site. Defaulting to `ready` is deliberate: publishing on a schedule hands a third
  -- party's file the ability to publish here, which is opted into rather than inherited.
  "publish_mode" text DEFAULT 'ready' NOT NULL,
  "is_premium" boolean DEFAULT false NOT NULL,
  "group_name" text,
  "active" boolean DEFAULT true NOT NULL,
  -- Digest of the chapter list the last check saw, so an unchanged file costs one fetch and
  -- no queries. Most checks of most sources find nothing, which is the case worth making cheap.
  "fingerprint" text,
  "last_checked_at" timestamp with time zone,
  "last_changed_at" timestamp with time zone,
  -- A sync that silently stops working is worse than no sync, because the operator believes
  -- the site is current. The reason is kept and shown, and cleared by the next good check.
  "last_error" text,
  "imported" integer DEFAULT 0 NOT NULL,
  "created_by" bigint REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "manifest_sources_series_url_lang_unique" UNIQUE ("series_id", "url", "language")
);
--> statement-breakpoint
-- The producer's query: active sources, least recently checked first. Partial because a
-- paused source is never due, and the index is read on every scheduler pass.
CREATE INDEX IF NOT EXISTS "manifest_sources_due_idx"
  ON "manifest_sources" ("last_checked_at")
  WHERE "active";
