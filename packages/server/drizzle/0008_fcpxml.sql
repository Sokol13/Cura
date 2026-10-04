CREATE TABLE fcpxml_jobs (id TEXT PRIMARY KEY NOT NULL, library_id TEXT NOT NULL REFERENCES libraries(id), payload TEXT NOT NULL CHECK(json_valid(payload)), package_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX fcpxml_jobs_library ON fcpxml_jobs(library_id,created_at,id);
