CREATE TABLE libraries (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE library_roots (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), path TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('reference','inbox')), removed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX library_roots_active_path ON library_roots(library_id,path) WHERE removed_at IS NULL;
--> statement-breakpoint
CREATE TABLE folders (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), name TEXT NOT NULL, parent_id TEXT REFERENCES folders(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE tag_groups (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE tags (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), name TEXT NOT NULL, color TEXT NOT NULL, group_id TEXT REFERENCES tag_groups(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE assets (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), root_id TEXT NOT NULL REFERENCES library_roots(id), relative_path TEXT NOT NULL, current_hash TEXT NOT NULL, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, deleted_at TEXT, payload TEXT NOT NULL CHECK(json_valid(payload)), search_text TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX assets_library_hash ON assets(library_id,current_hash);
--> statement-breakpoint
CREATE INDEX assets_library_folder ON assets(library_id,folder_id,deleted_at);
--> statement-breakpoint
CREATE TABLE asset_sources (id TEXT PRIMARY KEY NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id), root_id TEXT NOT NULL REFERENCES library_roots(id), relative_path TEXT NOT NULL, actual_relative_path TEXT NOT NULL, last_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(root_id,relative_path));
--> statement-breakpoint
CREATE INDEX asset_sources_asset ON asset_sources(asset_id);
--> statement-breakpoint
CREATE TABLE asset_versions (id TEXT PRIMARY KEY NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id), ordinal INTEGER NOT NULL CHECK(ordinal > 0), payload TEXT NOT NULL CHECK(json_valid(payload)), snapshot_path TEXT NOT NULL, thumbnail_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(asset_id,ordinal));
--> statement-breakpoint
CREATE TABLE asset_tags (asset_id TEXT NOT NULL REFERENCES assets(id), tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(asset_id,tag_id));
--> statement-breakpoint
CREATE INDEX asset_tags_tag ON asset_tags(tag_id,asset_id);
--> statement-breakpoint
CREATE TABLE collections (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), name TEXT NOT NULL, rules TEXT NOT NULL CHECK(json_valid(rules)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE annotations (id TEXT PRIMARY KEY NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id), version_id TEXT NOT NULL REFERENCES asset_versions(id), x REAL NOT NULL CHECK(x >= 0 AND x <= 1), y REAL NOT NULL CHECK(y >= 0 AND y <= 1), text TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE settings (id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL CHECK(json_valid(value)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE activity (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), asset_id TEXT REFERENCES assets(id), action TEXT NOT NULL, details TEXT NOT NULL CHECK(json_valid(details)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE VIRTUAL TABLE asset_fts USING fts5(asset_id UNINDEXED, text, tokenize='unicode61 remove_diacritics 2');
