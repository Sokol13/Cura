# Released v0.3.0 to v0.3.1 upgrade verifier

`upgrade.mjs` creates a private persisted fixture using services built from the
exact released `v0.3.0` commit `d90a567fbfe8989241bce8e65db27ffc31640c66`.
It then opens the same database with the candidate's real Drizzle migrations.
It does not manufacture legacy SQL tables or insert fixture rows directly.

The fixture retains Unicode names, duplicate source aliases, an unregistered
reference root, Inbox files, an archived offline asset, Trash, metadata, exact
64-bit seed strings, annotations, and a manual V1 → V2 replacement whose source
file still contains V1. Canvas and matrix slots preserve historical pins,
assignment history, deleted matrix cells, a deleted template, and independent
manual final ownership. Brands, a real original test font, CMF, completed/failed
local mock generation jobs, a completed metadata-rules analysis, a retained
script, a setting document and a disabled archive rule exercise existing domains.
No remote provider or cloud credentials are involved.

Before any new scan summary is written, the verifier compares every original
column and row in all released application and FTS tables, including IDs,
JSON payloads, source `last_hash` values and timestamps. The nine old migration
ledger entries and SQL file hashes must remain exact; only migration
`0009_scan_summaries` and its initially empty operational table may be added.
Public domain readers must preserve every previously returned value, while
allowing additive response fields.

A completed summary is then saved through the new ScanStore API. A late running
update must be rejected without mutating old rows. Two more database opens must
preserve the complete logical digest, all ten ledger entries and the saved
summary. Original files, retained snapshots and the closed backup are verified
by SHA-256; SQLite integrity and foreign-key checks must pass. The temporary
fixture and backup are removed in `finally` on success or failure.

## Reproduce

Use Node 22 for this cross-version check because that is the runtime declared by
the old release. Node 24 installation and full acceptance of the new release are
separate gates. Build each checkout separately so compiled workers and shared
schemas match its own source. Do not share `node_modules` between Node majors.

```sh
git worktree add --detach /workspace/cura-v030-upgrade-source v0.3.0
pnpm --dir /workspace/cura-v030-upgrade-source install --frozen-lockfile
pnpm --dir /workspace/cura-v030-upgrade-source --filter @cura/shared build
pnpm --dir /workspace/cura-v030-upgrade-source --filter @cura/server build

# In a clean, committed, version-bumped v0.3.1 candidate checkout:
pnpm install --frozen-lockfile
pnpm --filter @cura/shared build
pnpm --filter @cura/server build
NODE_PATH= node docs/evidence/v0.3.1/upgrade.mjs \
  /workspace/cura-v030-upgrade-source "$PWD" /tmp/cura-v031-upgrade.json
```

The final run rejects a dirty package/lockfile diff, a source checkout that is not
exactly the released tag, or candidate package versions other than `0.3.1`.
Success evidence contains source commits/trees, migration/file hashes, synthetic
IDs, table counts and checks, without absolute fixture paths or credentials.

Before the candidate is frozen, adding `--fixture-only` verifies only legacy
fixture creation and its closed backup. Its output is explicitly marked
`fixture-prepared-only`; this is not evidence of candidate migration success.
A final run recreates the fixture and writes `status: passed` only after every
migration, persistence and byte-integrity assertion passes.

This check covers synthetic persisted data on Linux. It does not claim physical
macOS/Windows execution, browser rendering, live Supabase or visual-model
behavior, or Final Cut Pro import.
