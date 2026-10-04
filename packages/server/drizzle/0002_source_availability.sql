ALTER TABLE asset_sources ADD COLUMN available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1));
--> statement-breakpoint
UPDATE asset_sources SET available=0 WHERE root_id IN (SELECT id FROM library_roots WHERE removed_at IS NOT NULL);
--> statement-breakpoint
CREATE INDEX asset_sources_available ON asset_sources(asset_id,available,root_id);
