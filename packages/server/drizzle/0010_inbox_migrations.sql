CREATE TABLE inbox_migrations (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL UNIQUE REFERENCES asset_sources(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  root_id TEXT NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,
  old_relative_path TEXT NOT NULL,
  old_actual_relative_path TEXT NOT NULL,
  new_relative_path TEXT NOT NULL,
  last_hash TEXT NOT NULL,
  source_available INTEGER NOT NULL CHECK(source_available IN (0,1)),
  source_created_at TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  observed TEXT NOT NULL CHECK(json_valid(observed)),
  target TEXT CHECK(target IS NULL OR json_valid(target)),
  state TEXT NOT NULL CHECK(state IN ('planned','reserved','published','relocated','complete')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX inbox_migrations_pending ON inbox_migrations(root_id,state);
