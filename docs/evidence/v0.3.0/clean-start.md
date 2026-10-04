# v0.3.0 clean-start acceptance

The frozen production source at
`41e45b187e2f6c0ae646f67e91fc909c3b320f97` passed this acceptance on Linux.
[Machine-readable results](clean-start.json) record a 2.4-second frozen install,
159 actual installed runtime license entries and a 24.4-second normal startup.
The default browser association automatically opened Cura; the verifier attached
to that existing page, created a library through the Chinese interface, reloaded
it and checked persistence. Both owned process groups and ports stopped before
the read-only SQLite integrity/foreign-key check.

The [content-only screenshot](../../screenshots/v0.3-clean-start.png) was inspected
at 1440 × 1000. It contains only synthetic acceptance data. All four package
versions are `0.3.0`; `NODE_PATH` was empty throughout install, startup and browser
verification. The same independent built clone also passed the renewed
[actual v0.2.0 upgrade](upgrade.md): 17 checks, 36 preserved legacy tables and two
idempotent reopens. The JSON records the exact source trees and built hashes, so
later documentation-only release commits can be compared without implying that
different production code was tested.

```sh
# Linux, Node 22 and the repository-pinned pnpm; choose an absent clone path.
NODE_PATH= node docs/evidence/v0.3.0/clean-start.mjs \
  /workspace/Cura 41e45b187e2f6c0ae646f67e91fc909c3b320f97 /workspace/cura-clean-v030-final \
  docs/evidence/v0.3.0/clean-start.json \
  docs/screenshots/v0.3-clean-start.png
```

The destination must not already exist. The source may be any local repository
containing the frozen commit. For a fresh public checkout, use published candidate `1f24a5b` (or the final `v0.3.0` tag) as the commit argument and choose a new destination; its complete package trees and lockfile are identical, as recorded in REPORT-v0.3.0.md. The original local commit ID records the historical measurement and need not be present in a public clone. `git clone --no-local` creates independent objects;
the verifier checks for absent shared-object alternates and `node_modules`, then
checks out the exact full commit. All four package versions must be `0.3.0`.

The harness performs the following checks:

1. Frozen install with an empty `NODE_PATH`; actual SQLite/Sharp prebuilt probes;
   no native compilation; no optional canvas package in the installed graph,
   physical package directory or Node resolution. Runtime license count comes
   from a fresh `pnpm licenses list --prod --json` query and must agree with the
   allowlist check; no package count is assumed.
2. New empty data/cache/log directories and browser profile. Private XDG
   HTTP/HTTPS associations point to a launcher for headless Chromium. The normal
   Cura opener invokes that desktop association with the application's URL.
   Global desktop associations remain unchanged. `DISPLAY=:99` selects Linux's
   desktop-opening branch; the test browser itself is headless and needs no X
   server. `CURA_CHROMIUM_EXECUTABLE` may select an installed Chromium binary.
3. Normal `pnpm start` with `CURA_OPEN_BROWSER=1`. Wait for the real health
   endpoint and recorded desktop-launch arguments, then connect Playwright over
   CDP to the page Cura already opened. The verifier never calls `goto` or
   `newPage`. Create a library through the default Chinese UI, reload, and check
   the same library identity and active-library setting through the real API.
4. Stop the owned browser and server process groups and verify both ports are
   closed. Open the closed database read-only, check the saved library/settings,
   nine migrations, SQLite integrity and foreign keys. Record actual source-tree
   IDs, built entrypoint hashes, complete build-directory manifest digests and
   the screenshot hash.

Successful runs remove private data/profile/log directories and retain only the
independent installed clone and selected evidence. Failed attempts stop owned
processes and retain private diagnostics for repair; they do not emit passing
evidence. Published JSON excludes local checkout/storage paths and credentials.

This harness verifies Linux headless desktop-association behavior. Physical
macOS/Windows, hosted cloud, model inference and full regression suites have
separate acceptance evidence. After clean startup passes, run `upgrade.mjs`
against the same freshly built production clone to renew the actual tagged
v0.2.0 database-upgrade evidence.
