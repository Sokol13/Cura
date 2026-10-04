# Cloud and team workspace

Cura works without an account or cloud configuration. Open **Cloud & team** from a library (Chinese: **云同步与团队**). Without server configuration the workspace shows **Local mode**; the library, previews, edits and exports remain local and available.

## Connect a project and account

Follow [the Supabase setup guide](../supabase/README.md) to apply the supplied database migration and Storage policies. Set `CURA_SUPABASE_URL` and `CURA_SUPABASE_ANON_KEY` on the local Cura server, then restart it. Use the public anon or publishable key; do not use a service-role key. Account creation and recovery remain in the configured project's authentication administration.

Sign in with the account's email and password. The local server manages the session; passwords and session tokens are never stored in browser local/session storage. **Refresh session** renews this device's session. **Sign out on this device** clears its server session without signing other devices out. A cloud or sign-in error does not remove local libraries.

## Publish, join and sync

1. Open the local library to share, then select **Publish this library**. Cura uploads the portable metadata and retained original version files. Progress reports the current phase and completed work.
2. Open **Manage team** and add a teammate's **Account UUID**, choosing Editor or Viewer. Their UUID appears in their own cloud workspace; it is not an email address.
3. On another Cura device, sign in and choose the authorized library under **Shared library**, then **Join library**. **Open library** becomes available after its received graph and files have been committed.
4. Use **Sync now** to request an incremental run. **Pause sync** holds work on this device; **Resume sync** restarts it. The local server also checks linked libraries periodically while signed in. “Ready to sync” describes an idle worker, not a promise that another device has no newer edits.

The workspace shows the role, transfer phase, pending local changes, last successful sync and actionable server errors. A paused or unavailable cloud connection does not prevent opening an already materialized local library. Retry after restoring connectivity or renewing an expired session. Incoming library data uses local managed storage; the other device's absolute filesystem paths are not reused.

## Team permissions and conflicts

Owners can add members, change Editor/Viewer roles and confirm access removal. The owner cannot be reassigned or removed. Editors can upload and download updates. Viewers have **Download updates**: their local edits stay on their device and are not uploaded, while incoming cloud updates can still be downloaded. Role changes and revoked access are enforced by the cloud service and reflected on the next sync. Removing access does not erase files already held by a member's device.

**View conflicts** retains the baseline, local, remote and resolved snapshots. Competing local edits take precedence; compatible metadata and immutable histories can merge. Conflicts also identify history ordinal changes and protection of a final selection. Expand snapshots to inspect them or download the complete conflict JSON. Very large snapshots are visibly truncated in the UI at 20,000 characters; the download remains complete. Conflict inspection is read-only and available for retained local records when the cloud is unavailable.

## Verification commands and boundaries

The default real-server browser suite includes `e2e/sync.spec.ts`: no cloud configuration, blocked external browser requests, bilingual local mode, theme and return to the library. Unit tests cover auth controls, password clearing, pending-operation locks, stale responses, polling, viewer behavior, team roles, modal keyboard handling and conflict download/retry.

Configured cloud acceptance has a separate mandatory release command so missing credentials cannot silently skip it. It uses two independent Cura servers and a disposable local Supabase stack with real Auth, Postgres and Storage. The development-only `supabase/seed-browser-fixture.mjs` command described in the setup guide creates a private fixture file outside the repository (0600 on Linux) with this structure:

```text
{url, anonKey, accounts: {
  owner: {id, email, password}, editor: {id, email, password},
  viewer: {id, email, password}, outsider: {id, email, password}
}}
```

The fixture must contain no service-role credential. Only a loopback Supabase URL is accepted by this test harness. Do not commit the fixture or its values.

```sh
pnpm build
NODE_PATH= CURA_SYNC_E2E_FIXTURE=/absolute/private/cura-e2e.private.json \
  CURA_E2E_PORT=4342 pnpm exec playwright test \
  --config=e2e/sync.configured.config.ts
```

The command uses ports 4342 and 4343 by default and cleans up its temporary Cura data directories when the servers exit. Browser trace, video and automatic screenshots are disabled because the test enters real disposable passwords. An explicit screenshot masks account email and UUID fields. Only redacted capability results are written to `docs/evidence/v0.3.0/cloud-workspace.json` after all assertions pass.

Configured acceptance covers publish/join, retained byte and version identity, incremental metadata, local-wins conflict inspection and downloaded JSON, owner add/change/remove, viewer pull with pending local edits, revoked/outsider access rejection, independent sign-out and absent browser credentials. Verified on 2026-10-04: all 15 focused cloud UI tests passed; the complete web suite passed 134 tests. The no-config real-server browser case passed in 1.6 seconds, and the configured two-device case passed in 32.4 seconds using freshly generated local Auth accounts. The redacted evidence file records the measured scope. The browser made zero requests outside the two Cura origins; server-to-Supabase traffic was real.

Headless Linux verification does not replace macOS/Windows smoke testing. On those systems, also check startup with and without configuration, reconnect after going offline, and reopening a joined library after restarting Cura. Hosted project configuration, deployment policy and desktop-specific credential-file permissions require verification in the intended environment.
