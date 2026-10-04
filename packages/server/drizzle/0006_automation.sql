CREATE TABLE automation_jobs (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), payload TEXT NOT NULL CHECK(json_valid(payload)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX automation_jobs_library ON automation_jobs(library_id, created_at);
--> statement-breakpoint
CREATE TABLE automation_proposals (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), job_id TEXT NOT NULL REFERENCES automation_jobs(id), asset_id TEXT NOT NULL REFERENCES assets(id), version_id TEXT NOT NULL REFERENCES asset_versions(id), payload TEXT NOT NULL CHECK(json_valid(payload)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX automation_proposals_job ON automation_proposals(library_id, job_id, created_at);
--> statement-breakpoint
CREATE TABLE automation_changes (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), proposal_id TEXT NOT NULL REFERENCES automation_proposals(id), asset_id TEXT NOT NULL REFERENCES assets(id), version_id TEXT NOT NULL REFERENCES asset_versions(id), field TEXT NOT NULL CHECK(field IN ('tagIds','displayName','archivedAt')), payload TEXT NOT NULL CHECK(json_valid(payload)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX automation_changes_proposal ON automation_changes(proposal_id);
--> statement-breakpoint
CREATE TABLE archive_rules (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), payload TEXT NOT NULL CHECK(json_valid(payload)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX archive_rules_library ON archive_rules(library_id, created_at);
--> statement-breakpoint
CREATE TABLE script_breakdowns (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), asset_id TEXT NOT NULL REFERENCES assets(id), version_id TEXT NOT NULL REFERENCES asset_versions(id), payload TEXT NOT NULL CHECK(json_valid(payload)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX script_breakdowns_library ON script_breakdowns(library_id, created_at);
--> statement-breakpoint
CREATE TABLE setting_documents (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), payload TEXT NOT NULL CHECK(json_valid(payload)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX setting_documents_library ON setting_documents(library_id, created_at);
