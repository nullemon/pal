-- Where visits come from (docs/13), and where a registered account came from.
--
-- Aggregate by construction: a row is a day, a source and a count. There is no visitor in
-- it and nothing to join back to a person, which is what keeps "no logs" true while still
-- answering "are these readers coming from the post on X, or from Discord, or from search?"
CREATE TABLE IF NOT EXISTS traffic_daily (
  bucket     date    NOT NULL,
  source     text    NOT NULL,
  campaign   text    NOT NULL DEFAULT '',
  hits       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, source, campaign)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS traffic_daily_bucket_idx ON traffic_daily (bucket DESC);
--> statement-breakpoint
-- One attribute on the account, written once at registration: which source the person came
-- from when they signed up. Not a history -- the single fact the team asked for ("are these
-- sign-ups from the X link?"), and nothing accumulates after it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_source text;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_campaign text;
