-- H · Two indexes the queue-health screen needs (docs/04 "Community", docs/07 SLA).
--
-- Neither changes a row. Both exist because `/admin/moderation` asks questions the
-- existing indexes cannot answer:
--
--   · "actions per moderator in this window" filters `audit_log` by `action LIKE 'report.%'`
--     and a `created_at` range. `audit_log_actor_idx` leads with the actor, so the planner
--     had nothing to narrow with and read every row ever written. On a fresh catalogue that
--     is nothing; on a year-old ledger it is the page load.
--   · the time-to-action percentiles read `reports.handled_at`, which was not indexed at
--     all. Partial on "handled", because the open reports a healthy queue is mostly made of
--     never qualify and keeping them out is most of the win.
--
-- Both are `IF NOT EXISTS`, so re-applying is a no-op, and both are declared in
-- `packages/db/src/schema/{system,comments}.ts` — an index without its model is exactly the
-- drift the earlier migrations warn about.
CREATE INDEX IF NOT EXISTS "audit_log_action_created_idx" ON "audit_log" USING btree ("action","created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reports_handled_at_idx" ON "reports" USING btree ("handled_at" DESC) WHERE "reports"."handled_at" is not null;
