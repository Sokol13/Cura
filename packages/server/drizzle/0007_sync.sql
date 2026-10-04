ALTER TABLE library_roots ADD COLUMN managed INTEGER NOT NULL DEFAULT 0 CHECK(managed IN (0,1));
--> statement-breakpoint
CREATE UNIQUE INDEX library_roots_one_managed ON library_roots(library_id) WHERE managed=1 AND removed_at IS NULL;
--> statement-breakpoint
CREATE TABLE sync_links (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL, account_id TEXT NOT NULL, managed_root_id TEXT REFERENCES library_roots(id), cursor TEXT NOT NULL DEFAULT '0', payload TEXT NOT NULL CHECK(json_valid(payload)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE sync_baselines (id TEXT PRIMARY KEY NOT NULL, link_id TEXT NOT NULL REFERENCES sync_links(id) ON DELETE CASCADE, kind TEXT NOT NULL, record_key TEXT NOT NULL, revision TEXT NOT NULL, payload TEXT CHECK(payload IS NULL OR json_valid(payload)), payload_hash TEXT NOT NULL, semantic_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(link_id,kind,record_key));
--> statement-breakpoint
CREATE TABLE sync_outbox (id TEXT PRIMARY KEY NOT NULL, link_id TEXT NOT NULL REFERENCES sync_links(id) ON DELETE CASCADE, request_hash TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), status TEXT NOT NULL CHECK(status IN ('pending','submitted','acknowledged')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX sync_outbox_pending ON sync_outbox(link_id,status,created_at);
--> statement-breakpoint
CREATE TABLE sync_staged_commits (id TEXT PRIMARY KEY NOT NULL, link_id TEXT NOT NULL REFERENCES sync_links(id) ON DELETE CASCADE, sequence TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(link_id,sequence));
--> statement-breakpoint
CREATE TABLE sync_conflicts (id TEXT PRIMARY KEY NOT NULL, link_id TEXT NOT NULL REFERENCES sync_links(id) ON DELETE CASCADE, kind TEXT NOT NULL, record_key TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX sync_conflicts_link ON sync_conflicts(link_id,created_at,id);
