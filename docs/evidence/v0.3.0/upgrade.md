# Actual v0.2.0 to P2 database upgrade

`upgrade.json` records an executed upgrade from the exact released `v0.2.0`
commit `571955275d7d5c3018aa9f340453f98229e518fd` to the candidate commit
identified in `target.commit`. The verifier uses separately built source trees
and actual services from each version. It does not manufacture an old database
with the new schema or insert synthetic SQL rows.

The evidence was renewed against frozen production source
`41e45b187e2f6c0ae646f67e91fc909c3b320f97` using the same independently installed
clone that passed [clean startup](clean-start.md). All 17 checks passed, including
36 legacy tables, five retained versions, four original source files and two
identical database reopen digests.

The generated fixture contains four assets and five retained versions, an NFD
reference filename with NFC catalog identity, Chinese metadata and annotations,
an exact unsigned 64-bit seed string, nested generation parameters, folders,
tags, a smart collection, settings and a trashed asset. P1 records include:

- A grouped canvas with an exact-version asset, text, connection and viewport.
- Canvas and matrix slots assigned V2 then V1, with independent manual V2 and
  historical slot V1 final owners.
- Reordered/renamed matrix axes, deleted cells and a deleted custom template,
  including retained slot history and stable identities.
- A brand with colors, two version-pinned logos, a real original MIT triangle
  font from the released browser fixture, and a CMF entry.
- A completed local mock generation job and an explicit failed mock job, plus
  recorded generations, timeline and statistics. This is not model inference.

After closing the old workers and database, the verifier copies and hashes the
database backup and its retained files. P2 then applies migrations `0006` through
`0008`. The verifier compares every original column and row in all 36 old
application/FTS tables, checks the original six migration journal rows, compares
domain readers, and verifies the new nullable display/archive fields and managed
root default. The new P2 tables initially contain no records.

A real loopback HTTP server subsequently runs health, automation proposal
apply/undo, display-name normalization, archive/restore, atomic final-owner
protection, strict UTF-8 script import and historical-version setting-document
creation/export. Neutral export must retain all P1 structures and P2 referenced
dependencies. Two further database opens must preserve the complete logical
database digest and migration journal, pass SQLite integrity/foreign-key checks,
and preserve every original source and retained-version SHA-256.

## Reproduce

Use Node 22 and the repository-pinned pnpm version. Build the two checkouts
separately so their `@cura/shared` packages and compiled workers match their
respective sources. The old checkout must be clean and point exactly at the
release tag; the script verifies this before creating any data.

```sh
git worktree add --detach /tmp/cura-upgrade-v020 v0.2.0
pnpm --dir /tmp/cura-upgrade-v020 install --frozen-lockfile
pnpm --dir /tmp/cura-upgrade-v020 --filter @cura/shared build
pnpm --dir /tmp/cura-upgrade-v020 --filter @cura/server build

# Run these from the current P2 checkout.
pnpm install --frozen-lockfile
pnpm --filter @cura/shared build
pnpm --filter @cura/server build
node docs/evidence/v0.3.0/upgrade.mjs \
  /tmp/cura-upgrade-v020 "$PWD" /tmp/cura-upgrade-result.json
```

The script accepts arbitrary absolute checkout/output paths. Its temporary
private database, source files, cache and backup are removed on success or
failure. Saved evidence contains synthetic labels, random record IDs, source
commit/tree hashes and migration/file hashes; it omits absolute checkout/data
paths, tokens and account data. The stored run used an empty `NODE_PATH`.

This evidence covers Linux migration and local API behavior. It does not claim
physical macOS/Windows execution, browser rendering, hosted cloud migration,
live Supabase behavior, visual-model accuracy or Final Cut Pro import.
