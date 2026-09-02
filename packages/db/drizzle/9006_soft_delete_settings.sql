-- Security review · docs/16 "nothing is hard-deleted": admin-managed lookup tables get deleted_at.
ALTER TABLE "link_allowlist" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "word_filters" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "redirects" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
