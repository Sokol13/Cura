CREATE TABLE slot_templates (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), name TEXT NOT NULL, preset TEXT CHECK(preset IN ('character','scene','product','brand')), slots_json TEXT NOT NULL CHECK(json_valid(slots_json)), deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(id,library_id));
--> statement-breakpoint
CREATE UNIQUE INDEX slot_templates_preset ON slot_templates(library_id,preset) WHERE preset IS NOT NULL;
--> statement-breakpoint
CREATE TABLE boards (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('canvas','matrix')), revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0), viewport TEXT NOT NULL CHECK(json_valid(viewport)), rows_json TEXT NOT NULL CHECK(json_valid(rows_json)), columns_json TEXT NOT NULL CHECK(json_valid(columns_json)), template_id TEXT, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(id,library_id), FOREIGN KEY(template_id,library_id) REFERENCES slot_templates(id,library_id));
--> statement-breakpoint
CREATE INDEX boards_library ON boards(library_id,deleted_at,updated_at);
--> statement-breakpoint
CREATE TABLE board_items (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), board_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('asset','text','group')), x REAL NOT NULL, y REAL NOT NULL, width REAL NOT NULL, height REAL NOT NULL, group_id TEXT REFERENCES board_items(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED, label TEXT NOT NULL, text TEXT NOT NULL, asset_id TEXT REFERENCES assets(id), version_id TEXT REFERENCES asset_versions(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(id,board_id), FOREIGN KEY(board_id,library_id) REFERENCES boards(id,library_id), CHECK((kind='asset' AND asset_id IS NOT NULL AND version_id IS NOT NULL) OR (kind<>'asset' AND asset_id IS NULL AND version_id IS NULL)));
--> statement-breakpoint
CREATE INDEX board_items_board ON board_items(board_id);
--> statement-breakpoint
CREATE TABLE board_edges (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), board_id TEXT NOT NULL, source_id TEXT NOT NULL, target_id TEXT NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(board_id,library_id) REFERENCES boards(id,library_id), FOREIGN KEY(source_id,board_id) REFERENCES board_items(id,board_id) ON DELETE CASCADE, FOREIGN KEY(target_id,board_id) REFERENCES board_items(id,board_id) ON DELETE CASCADE);
--> statement-breakpoint
CREATE INDEX board_edges_board ON board_edges(board_id);
--> statement-breakpoint
CREATE TABLE slots (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), board_id TEXT NOT NULL, label TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, width REAL NOT NULL, height REAL NOT NULL, row_id TEXT, column_id TEXT, template_key TEXT, revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0), asset_id TEXT REFERENCES assets(id), version_id TEXT REFERENCES asset_versions(id), deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(board_id,library_id) REFERENCES boards(id,library_id), CHECK((asset_id IS NULL AND version_id IS NULL) OR (asset_id IS NOT NULL AND version_id IS NOT NULL)), CHECK((row_id IS NULL AND column_id IS NULL) OR (row_id IS NOT NULL AND column_id IS NOT NULL)), UNIQUE(board_id,row_id,column_id), UNIQUE(id,library_id));
--> statement-breakpoint
CREATE INDEX slots_board ON slots(board_id,deleted_at);
--> statement-breakpoint
CREATE TABLE slot_revisions (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), slot_id TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK(ordinal>0), asset_id TEXT REFERENCES assets(id), version_id TEXT REFERENCES asset_versions(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(slot_id,library_id) REFERENCES slots(id,library_id), UNIQUE(slot_id,ordinal), CHECK((asset_id IS NULL AND version_id IS NULL) OR (asset_id IS NOT NULL AND version_id IS NOT NULL)));
