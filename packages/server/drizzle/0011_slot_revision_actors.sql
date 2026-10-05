ALTER TABLE slot_revisions ADD COLUMN actor_json TEXT CHECK(actor_json IS NULL OR json_valid(actor_json));
