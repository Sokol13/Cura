# Upgrading an existing Cura library

Cura applies pending SQLite migrations when the server starts. The v0.1.0 → v0.2.0 path adds process/final-selection, board/slot, and brand/CMF records while retaining existing catalog identities, settings, source references, and version bytes.

## Upgrade and recovery

1. Stop Cura and wait for the server to exit. Use one Cura server per data directory.
2. Copy the **entire data directory** to a backup, including retained version bytes and Inbox files. Back up registered original folders separately. See [data directory locations](SETUP.md#data-directories-and-backup); a copy of `cura.sqlite` alone is incomplete.
3. Install and build the new version with its supported Node 22/pnpm versions. Keep the existing data directory and any `CURA_DATA_DIR`, `CURA_CACHE_DIR`, and `CURA_LOG_DIR` overrides. Start the new version normally; no manual SQL step is required.
4. Check an existing library, folder/tag assignments, notes, annotations, both old and current asset versions, and the Creative process final selection. Create a board or brand, then restart Cura to check persistence. Cache thumbnails can be rebuilt separately.

To roll back, stop Cura, restore the complete pre-upgrade data backup to its original location, then run the old version. Opening an already upgraded database with an older binary is not a supported rollback. Do not combine a restored database with a different retained-byte/Inbox directory.

## Verified v0.1.0 → P1 migration

[Machine-readable evidence](evidence/v0.2.0/upgrade.json) records a successful Linux x64 / Node 22.23.3 run on 2026-10-04. The released server and shared source trees from `v0.1.0` (`c564361`) are identical to the built clean checkout `8cec733` used for fixture creation. The target was the isolated P1 checkout `dfa26ac`.

The check created the old database with the released `openDatabase`, `CatalogStore`, and `MediaService`; it did not construct legacy tables by hand. It then opened that same database with P1's real Drizzle migrations and stores.

- The migration ledger advanced from 3 to 6 entries and retained the original three entries unchanged. The artifact includes SHA-256 hashes of all migration SQL files.
- A Unicode source path, one asset with V1/V2 replacement history, library/root/asset/version identities and timestamps, two nested folders, a tag group/tag, rating, note, generation metadata, two version-specific annotations, and settings survived unchanged.
- The PNG-extracted seed `18446744073709551615` remained an exact string on both versions. Each retained version received a stable legacy generation identity; the existing manually finalized current version became a manual final-selection owner.
- A new 2 × 4 board matrix and a brand with a color and pinned logo were created using retained historical bytes. The slot's historical pin and existing manual current-version selection remained independent.
- Two subsequent database reopens left the complete logical table digest, migration ledger, generation identities, and new domain records unchanged. They introduced no duplicate backfill records.
- SHA-256 checks confirmed the registered original and both retained versions were unchanged. SQLite integrity and foreign-key checks passed.

This is an actual persisted-data migration check using synthetic records. Browser acceptance and large-catalog performance are separate release gates.

## Reproduce without touching user data

Prepare separately installed and built v0.1.0 and P1 source directories using `pnpm install --frozen-lockfile`, `pnpm --filter @cura/shared build`, and `pnpm --filter @cura/server build` in each directory. Then run:

```sh
node docs/evidence/v0.2.0/verify-upgrade.mjs \
  /path/to/built-v0.1.0 \
  /path/to/built-p1 \
  /tmp/cura-upgrade.json
```

The [standalone verifier](evidence/v0.2.0/verify-upgrade.mjs) accepts explicit built-directory paths and does not invoke Git. It generates private temporary data, closes the old media worker/database, copies a backup, performs the migration and two reopens, and deletes the temporary fixture in `finally`. It writes success evidence only after all assertions pass. The JSON contains synthetic names/UUIDs, hashes, and check results, with no absolute data paths or credentials.
