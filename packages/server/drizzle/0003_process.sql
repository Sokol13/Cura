CREATE TABLE recorded_generations (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), hash TEXT NOT NULL, source TEXT NOT NULL, model TEXT NOT NULL, origin TEXT NOT NULL CHECK(origin IN ('recorded','legacy-backfill')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX recorded_generations_library ON recorded_generations(library_id,source,model);
--> statement-breakpoint
INSERT INTO recorded_generations SELECT min(v.id), a.library_id, json_extract(v.payload,'$.hash'), coalesce(json_extract(v.payload,'$.source'),''), coalesce(json_extract(v.payload,'$.model'),''), 'legacy-backfill', v.created_at, max(v.updated_at) FROM asset_versions v JOIN assets a ON a.id=v.asset_id GROUP BY a.library_id,json_extract(v.payload,'$.hash'),v.created_at;
--> statement-breakpoint
UPDATE asset_versions SET payload=json_set(payload,'$.generationId',(SELECT g.id FROM recorded_generations g JOIN assets a ON a.library_id=g.library_id WHERE a.id=asset_versions.asset_id AND g.hash=json_extract(asset_versions.payload,'$.hash') AND g.created_at=asset_versions.created_at));
--> statement-breakpoint
UPDATE assets SET payload=json_set(payload,'$.generationId',(SELECT json_extract(v.payload,'$.generationId') FROM asset_versions v WHERE v.id=json_extract(assets.payload,'$.currentVersionId')));
--> statement-breakpoint
CREATE TABLE final_selections (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), owner_kind TEXT NOT NULL CHECK(owner_kind IN ('manual','slot')), owner_id TEXT NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id), version_id TEXT NOT NULL REFERENCES asset_versions(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(library_id,owner_kind,owner_id));
--> statement-breakpoint
CREATE INDEX final_selections_version ON final_selections(version_id);
--> statement-breakpoint
CREATE INDEX final_selections_asset ON final_selections(asset_id);
--> statement-breakpoint
INSERT INTO final_selections SELECT id,library_id,'manual',id,id,json_extract(payload,'$.currentVersionId'),created_at,updated_at FROM assets WHERE json_extract(payload,'$.finalized')=1;
--> statement-breakpoint
CREATE TABLE generation_jobs (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), payload TEXT NOT NULL CHECK(json_valid(payload)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE export_jobs (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), payload TEXT NOT NULL CHECK(json_valid(payload)), archive_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
