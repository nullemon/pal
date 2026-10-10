-- Pages that live on someone else's host.
--
-- A chapter imported from a gallery link can either be downloaded into our bucket, as every
-- chapter has been until now, or left where it is and served through our own proxy route.
-- The second is what makes "paste a link, get a chapter" cost nothing in storage, and it is
-- the mode the operator asked for by default.
--
-- `remote_url` being set is the whole flag: when it is, `key` names no object in the bucket
-- and nothing may try to read one. `key` still carries a value (`remote:<hash>`) rather than
-- being made nullable, because every consumer already treats it as present, and a key that
-- is obviously not a bucket path fails loudly if some path does reach the store with it —
-- which is a far better outcome than a NULL spreading quietly through the same code.
--
-- No backfill: every existing row is a stored page, and NULL already means exactly that.
ALTER TABLE "chapter_pages" ADD COLUMN IF NOT EXISTS "remote_url" text;
--> statement-breakpoint
-- The mirror and the watermark sweep both walk pages looking for objects to copy or re-mark,
-- and must skip remote rows entirely. Partial, because remote pages are the minority and the
-- question those jobs ask is always "which of these are stored".
CREATE INDEX IF NOT EXISTS "chapter_pages_remote_idx"
  ON "chapter_pages" ("chapter_id")
  WHERE "remote_url" IS NOT NULL;
