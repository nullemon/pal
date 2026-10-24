-- Turning the credit page off for work that is not ours (docs/03).
--
-- A site that hosts another group's chapters must not print its own team on them. The
-- feature is site-wide, so the exception has to be per series -- and per chapter, for the
-- one-off that arrives from elsewhere inside a run that is otherwise ours.
ALTER TABLE series ADD COLUMN IF NOT EXISTS credit_disabled boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS credit_disabled boolean NOT NULL DEFAULT false;
