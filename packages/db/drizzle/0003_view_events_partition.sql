-- Hand-written (docs/02 "Views and ranking"): view_events is append-only and partitioned
-- by day so the rollup job can drop partitions older than 90 days instead of bulk-deleting.
-- drizzle-kit cannot express PARTITION BY, so the snapshot is unchanged and `generate`
-- keeps reporting no diff. The worker (P5) must create the daily partition ahead of time
-- (`CREATE TABLE view_events_YYYYMMDD PARTITION OF view_events FOR VALUES FROM ('YYYY-MM-DD')
-- TO ('YYYY-MM-DD+1')`); rows for days without a partition land in `view_events_default`.
DROP TABLE "view_events";--> statement-breakpoint
CREATE TABLE "view_events" (
	"series_id" bigint NOT NULL,
	"chapter_id" bigint DEFAULT 0 NOT NULL,
	"bucket" date NOT NULL,
	"viewer_key" "bytea" NOT NULL,
	CONSTRAINT "view_events_bucket_series_id_viewer_key_chapter_id_pk" PRIMARY KEY("bucket","series_id","viewer_key","chapter_id")
) PARTITION BY RANGE ("bucket");--> statement-breakpoint
CREATE TABLE "view_events_default" PARTITION OF "view_events" DEFAULT;
