# Released v0.3.1 slot-history upgrade acceptance

On 2026-10-05, the exact released `a078429110b64e99b4358e709de6657f84ccd9ab` runtime upgraded to the item 13 backend candidate `f8c4c470a197124f964d3af799ca6e6b8ad6a68f` and passed **40 checks across upgrade, a new assignment, and closed-database restart**. See the [result](slot-history-upgrade.json) and [executable harness](slot-history-upgrade.mjs).

The candidate commit is an isolated local checkpoint, not a published release identity. Publication may squash commits through the GitHub app. Exact source identities are retained in the JSON: candidate server tree `21a32575e208a2dac3073af8aea71ea55f381f44`, shared tree `f5f94da3b379669eb2e4c0792bd212e75a2d8d46`, and lockfile blob `307e89060e7f24c4ba19b6e8dcdd11f23a5a6615`. Integration checkpoint `f52de027324c8f782e46ab305e514d74dccfb680` was independently checked to have the same server/shared trees and lockfile blob. Compare those trees when relating this evidence to a later published commit.

## Fixture and observations

The harness imported the production built `createApp`, database, and portable-graph modules from clean source checkouts. It used real loopback HTTP, actual SQLite migrations and worker-generated images, with optional cloud configuration removed. It created fresh generated data, independent of the earlier Inbox upgrade archive:

- Two PNG assets, each with a manually replaced V2; four immutable versions in total.
- A board and slot with three assignments: **A/V1 → B/V2 → A/V1**. A was replaced with V2 after these assignments, so the slot's A/V1 differs from its asset's current version.
- Authored display names, Chinese notes, rating, folder, tag, edited generation metadata with a nested authored `updatedAt` value, and an annotation pinned to A/V1.
- The genuine released runtime had ten migrations and no actor column. It returned three actorless history entries. After closing it, the harness copied its complete working data/cache/log tree to an untouched frozen backup and saved the full SQL, portable-graph and retained-byte baseline.

The candidate applied migrations through twelve. Before any new assignment, its **entire portable graph was deeply equal to the old graph and its semantic hash was unchanged**. Legacy revision fields, timestamps, pins and ordinals stayed exact; the added actor column remained SQL NULL and the portable/API histories omitted `actor`. History response names, media types and ordinals matched the exact pinned version payload, including A/V1 while A/V2 was current. Every retained version downloaded over HTTP with its original SHA-256.

A subsequent real HTTP assignment to B/V2 created exactly one fourth history entry with `{ "kind": "local" }`. The actor, complete history, portable graph and SQL revision state survived a closed-database restart. All four immutable version rows, retained bytes, thumbnails, authored folder/tag/link/annotation rows and legacy history remained unchanged. SQLite integrity and foreign-key checks passed on every captured stage, and a final recursive file-hash comparison proved the frozen backup stayed unchanged.

After the **new** assignment only, changing slot final-selection ownership legitimately updates the two affected assets' `updatedAt` values. The initial exploratory assertion was too strict about those timestamps. The final harness permits only that asset-level timestamp difference, still compares every other field exactly, and also requires equal semantic hashes for those existing asset records. It does not relax the pre-assignment upgrade comparison or legacy history timestamps. The archived harness was rerun from an entirely fresh old-runtime fixture and passed all 40 checks.

## Reproduce

Use Node 22 and clean, installed checkouts at the exact released and candidate commits. Build shared and server packages in each checkout:

```bash
pnpm --filter @cura/shared build
pnpm --filter @cura/server build
```

From the repository containing the archived harness, supply an explicit fresh directory outside the source checkout:

```bash
released_source=/path/to/clean-a078429
candidate_source=/path/to/clean-candidate
fixture_dir=$(mktemp -d /tmp/cura-slot-history-upgrade-XXXXXX)

node docs/evidence/v0.4.0/slot-history-upgrade.mjs seed \
  "$released_source" a078429110b64e99b4358e709de6657f84ccd9ab "$fixture_dir"
node docs/evidence/v0.4.0/slot-history-upgrade.mjs verify \
  "$candidate_source" "$(git -C "$candidate_source" rev-parse HEAD)" "$fixture_dir"
```

Both commands reject dirty source checkouts and verify the supplied commit identity. Seed writes `baseline.json`, `context.json`, `seed-evidence.json`, and the closed `frozen-v031` backup. Verify writes the before/after/reopened snapshots and `upgrade-evidence.json`. The live working tree retains its original absolute paths so the SQLite locators are not rewritten by the harness. Each phase closes its own server and database. A repeat upgrade requires another fresh fixture, rather than rerunning against the already-mutated working database.

The archived result was produced in `/tmp/cura-item13-upgrade-archive-WtkRmE` on Linux with Node `v22.23.3`. This verifies the real production server/database upgrade, not CLI startup, browser behavior, authenticated-account attribution, physical Windows/macOS behavior, or item 15 performance.
