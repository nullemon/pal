-- Following a manifest means releases appear without anybody being awake (docs/03).
--
-- `ready` was the default on the reasoning that handing a third party's file the ability to
-- publish is a decision to opt into. On a site whose manifests are its own group's, that
-- reasoning is wrong in practice: the feature imported chapters and left them as drafts,
-- which looks exactly like a sync that is not working -- and did, for a week.
ALTER TABLE manifest_sources ALTER COLUMN publish_mode SET DEFAULT 'publish';
--> statement-breakpoint
-- Existing sources come with it. They were all created under the old default rather than
-- chosen, and a source left on `ready` after this is a series that silently stops updating.
UPDATE manifest_sources SET publish_mode = 'publish' WHERE publish_mode = 'ready';
