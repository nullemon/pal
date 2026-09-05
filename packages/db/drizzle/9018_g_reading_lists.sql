-- G · polish carried over (docs/17 §G, docs/13 "Custom reading lists"): user-named reading
-- lists beyond the five fixed bookmark statuses, optionally published at a shareable URL.
--
-- Two tables and nothing else. Ordering lives in `reading_list_items.position` as a dense
-- 0…n-1 sequence the application rewrites on every move, rather than as fractional ranks:
-- a list is small (capped in the API), so rewriting it is one cheap statement, and a dense
-- sequence cannot drift into the tie-breaking mess that fractional keys reach after a few
-- hundred reorders.
--
-- Membership uniqueness is the primary key, not an application check: a double-tap on
-- "Add to list" then costs an ON CONFLICT, not a duplicate row.
CREATE TABLE IF NOT EXISTS "reading_lists" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
  "user_id" bigint NOT NULL,
  "name" text NOT NULL,
  -- citext so `/lists/reader/Best-Of` and `/lists/reader/best-of` are the same list, and so
  -- the uniqueness below is case-insensitive too.
  "slug" "citext" NOT NULL,
  "description" text,
  "is_public" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "reading_lists_user_id_slug_unique" UNIQUE("user_id","slug"),
  CONSTRAINT "reading_lists_name_check" CHECK (length(btrim("name")) between 1 and 60)
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "reading_lists" ADD CONSTRAINT "reading_lists_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
-- The owner's own index: /me/lists is "my lists, most recently touched first".
CREATE INDEX IF NOT EXISTS "reading_lists_user_idx" ON "reading_lists" USING btree ("user_id","updated_at" DESC);--> statement-breakpoint
-- Published lists only; a partial index so private lists cost nothing to keep out of it.
CREATE INDEX IF NOT EXISTS "reading_lists_public_idx" ON "reading_lists" USING btree ("updated_at" DESC) WHERE "reading_lists"."is_public";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reading_list_items" (
  "list_id" bigint NOT NULL,
  "series_id" bigint NOT NULL,
  "position" integer NOT NULL,
  "added_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "reading_list_items_list_id_series_id_pk" PRIMARY KEY("list_id","series_id")
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "reading_list_items" ADD CONSTRAINT "reading_list_items_list_id_reading_lists_id_fk"
    FOREIGN KEY ("list_id") REFERENCES "reading_lists"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "reading_list_items" ADD CONSTRAINT "reading_list_items_series_id_series_id_fk"
    FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
-- Reading a list is always "this list, in order".
CREATE INDEX IF NOT EXISTS "reading_list_items_order_idx" ON "reading_list_items" USING btree ("list_id","position");--> statement-breakpoint
-- Supports the delete cascade from `series` and "which of my lists is this series already in".
CREATE INDEX IF NOT EXISTS "reading_list_items_series_idx" ON "reading_list_items" USING btree ("series_id");
