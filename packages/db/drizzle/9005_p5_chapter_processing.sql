-- P5 · upload pipeline: the worker's per-chapter processing document
-- { sources: [{ idx, key, bytes, sha256 }], progress: { done, total }, errors: { "<idx>": "message" },
--   started_at, finished_at, attempt }
ALTER TABLE "chapters" ADD COLUMN IF NOT EXISTS "processing" jsonb;
