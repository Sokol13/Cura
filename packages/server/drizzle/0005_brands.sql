CREATE TABLE brands (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), name TEXT NOT NULL, guidelines TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX brands_library ON brands(library_id);
--> statement-breakpoint
CREATE TABLE brand_colors (id TEXT PRIMARY KEY NOT NULL, brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE, name TEXT NOT NULL, hex TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE brand_fonts (id TEXT PRIMARY KEY NOT NULL, brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE, name TEXT NOT NULL, role TEXT NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id), version_id TEXT NOT NULL REFERENCES asset_versions(id), position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE brand_logos (id TEXT PRIMARY KEY NOT NULL, brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE, name TEXT NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id), version_id TEXT NOT NULL REFERENCES asset_versions(id), position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE cmf_boards (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX cmf_boards_library ON cmf_boards(library_id);
--> statement-breakpoint
CREATE TABLE cmf_entries (id TEXT PRIMARY KEY NOT NULL, board_id TEXT NOT NULL REFERENCES cmf_boards(id) ON DELETE CASCADE, name TEXT NOT NULL, color_name TEXT NOT NULL, hex TEXT NOT NULL, process TEXT NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id), version_id TEXT NOT NULL REFERENCES asset_versions(id), position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
