-- H · "do not lose my place" + "this chapter is broken".
--
-- Almost all of this scope is application logic over tables that already exist:
--
--   * anonymous reading progress lives in the reader's own browser and never reaches
--     Postgres at all, so it has no schema;
--   * the signed-in conflict rule is decided against `reading_progress.read_at`, which
--     is now written as *when the position was observed on the device* rather than when
--     the row happened to be updated — a change of meaning, not of type;
--   * chapter reports reuse the one `reports` queue (kind `broken_chapter`, target_type
--     `chapter`), whose `reporter_id` has always been nullable, which is what lets a
--     signed-out reader file one.
--
-- What is genuinely missing is a handle on an anonymous reporter. `comments.ip_hash`
-- already sets the precedent: the address is never stored, only its HMAC under the
-- rotating salt. Without it the report route cannot tell "five readers found the same
-- broken chapter" (signal worth keeping five rows for) from "one reader tapped Report
-- five times" (one row), and moderators have nothing to group repeat abuse by.
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "ip_hash" bytea;--> statement-breakpoint
-- The dedupe lookup the chapter-report route runs before every insert: "an open report of
-- this kind, on this chapter, filed recently". Partial on `open` so handled reports — the
-- overwhelming majority once the queue has been worked for a while — stay out of it.
CREATE INDEX IF NOT EXISTS "reports_open_target_created_idx"
  ON "reports" USING btree ("kind","target_id","created_at" DESC)
  WHERE "status" = 'open';
