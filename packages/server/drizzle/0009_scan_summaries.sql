CREATE TABLE root_scan_summaries (
  root_id TEXT PRIMARY KEY NOT NULL REFERENCES library_roots(id),
  library_id TEXT NOT NULL REFERENCES libraries(id),
  scan_id TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX root_scan_summaries_library ON root_scan_summaries(library_id);
