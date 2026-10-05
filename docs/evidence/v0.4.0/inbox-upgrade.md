# Released Inbox upgrade acceptance

[inbox-upgrade.json](inbox-upgrade.json) records the completed upgrade from released v0.3.1 (`a078429110b64e99b4358e709de6657f84ccd9ab`) to item 11 (`977607d5e0e4adc46cbef622b098d58036e926e5`). Both independent source checkouts were clean, explicitly built, and run on Node 22.23.3 / module ABI 127. The candidate's seven recorded production tree identities matched the integrated commit. The candidate was installed with the frozen lockfile at `7369051`; package manifests and lockfile were unchanged at `977607d`, which was explicitly rebuilt. Build/install log hashes remain in the evidence.

## Fixture and result

The released application created the fixture through real loopback HTTP, with its real media worker and SQLite database. [inbox-seed.json](inbox-seed.json) records 7 assets, 8 versions and 9 sources: 7 present legacy Inbox sources, 1 missing Inbox original and 1 external reference control. Cases include Chinese names, an NFD upload request plus an actual physical NFD rename observed by the old scanner, two equal-name/different-content pairs, two dedup aliases, a V1 alias retained after manual replacement by a differently named V2, a trashed asset, and authored metadata, folder, tag and annotation.

The closed released database and all retained data were backed up before migration. The two candidate starts passed all 54 named checks recorded in the JSON, including:

- All 8 immutable version SQL rows, snapshot bytes, thumbnail bytes and existing source bytes remain identical.
- Asset identities, hashes, authored metadata/timestamps and the manual V2 selection are unchanged. Each primary locator follows only its original source; aliases do not replace it.
- Exactly 7 sources move to their local creation-date directories. Exactly 2 colliding names receive eight-character suffixes. Physical NFD is normalized, and emptied legacy UUID directories are removed.
- The unavailable source row, including timestamps, remains exact; its missing original is never reconstructed from a retained snapshot. The external reference locator and bytes remain unchanged.
- Derived search text and FTS logical rows change by exactly the old-to-new relative-path substitutions. Real HTTP searches find new locators and aliases, including Trash, reject moved UUID locators, and retain missing/reference locator searches.
- All portable graph records and their semantic hash remain identical. The local migration journal is absent from that graph.
- Only SQL migration 0010 and its local `inbox_migrations` table are added: 11 migration registrations, 7 completed journal rows, `integrity_check=ok`, and no foreign-key violations. The second start retains identical journal rows, source mappings, assets, versions and portable records.

Some of the 54 checks compare legacy tables that are empty in this fixture; they verify absence of unintended changes, not coverage of every feature represented by those tables. Permanent API/browser and migration fault-injection tests provide separate coverage.

Allowed operational changes are the verified derived search-path updates, normal startup/rescan summary updates, normal source-observation `updated_at` updates, migration registration and the local relocation journal. Authored asset/version timestamps are not exempt. The missing source row is compared without exemptions.

## Reproduce

Use Node 22 or 24 and the repository's pnpm version. The recorded run used Node 22.23.3; these instructions do not imply a second Node version was measured. Run from a checkout containing both exact commits. Use a **new generated acceptance directory**, never an existing Cura user-data directory. This script creates and migrates test data; do not point its fixture index at personal data.

```sh
inbox_acceptance_root="$PWD/.tmp/inbox-upgrade-reproduction"
mkdir -p "$inbox_acceptance_root"
git clone --no-local . "$inbox_acceptance_root/released"
git -C "$inbox_acceptance_root/released" checkout --detach a078429110b64e99b4358e709de6657f84ccd9ab
git clone --no-local . "$inbox_acceptance_root/candidate"
git -C "$inbox_acceptance_root/candidate" checkout --detach 977607d5e0e4adc46cbef622b098d58036e926e5

pnpm --dir "$inbox_acceptance_root/released" install --frozen-lockfile
pnpm --dir "$inbox_acceptance_root/released" --filter @cura/shared build
pnpm --dir "$inbox_acceptance_root/released" --filter @cura/server build
pnpm --dir "$inbox_acceptance_root/candidate" install --frozen-lockfile
pnpm --dir "$inbox_acceptance_root/candidate" --filter @cura/shared build
pnpm --dir "$inbox_acceptance_root/candidate" --filter @cura/server build

export CURA_INBOX_ACCEPTANCE_DIR="$inbox_acceptance_root/fixtures"
node docs/evidence/v0.4.0/inbox-upgrade.mjs seed "$inbox_acceptance_root/released"
node docs/evidence/v0.4.0/inbox-upgrade.mjs verify "$inbox_acceptance_root/candidate" 977607d5e0e4adc46cbef622b098d58036e926e5
```

`CURA_INBOX_ACCEPTANCE_DIR` defaults to `<current directory>/.tmp/inbox-upgrade` when unset. Keep the same directory for both commands. `seed` writes `seed-evidence.json`, a private `.tmp/fixture.json`, full SQL/byte baselines, and a closed data backup. `verify` performs **two** candidate starts and writes `upgrade-evidence.json`; it does not overwrite the closed backup. To repeat the migration itself, use another new acceptance directory and rerun `seed`. UUIDs, dates, collision suffixes and graph hashes vary with a fresh seed; equality is asserted within that run. Servers, workers and database handles close before the commands exit.

Only the compact evidence JSON is suitable for publication. The private fixture index, full SQL snapshots and raw failure logs can contain absolute paths. The recorded publication step checked source commits and production-tree equality, verified the original closed database SHA-256 against the seed record, added build-log hashes and rejected absolute private paths from the published JSON. The machine-specific publication helper is not required to run the verifier.

## Verifier provenance and limits

The original measured verifier SHA-256 remains unchanged in `inbox-upgrade.json` at `provenance.verifierSha256`. The archived [inbox-upgrade.mjs](inbox-upgrade.mjs) replaces the machine-specific base directory with the documented configuration above and applies repository formatting. Its separate hash and fresh-seed rerun result are recorded in [inbox-verifier-validation.json](inbox-verifier-validation.json); the archived hash must not be presented as the original measured hash.

Two earlier checks refined the harness: search indexes intentionally follow relocated paths, and historical SQLite Drizzle registration IDs are null, so migration registrations are matched by hash and full row. The final recorded run starts again from the untouched released backup; those refinements are not product failures.

These are generated Linux fixtures and real local HTTP/worker/SQLite operations. They do not establish macOS/Windows filesystem behavior, protected-directory permissions, occupied-file behavior, or cloud-provider behavior. This verifier does not measure browser rendering or performance. The intentionally missing original remains missing throughout; only its retained snapshot bytes are verified.
