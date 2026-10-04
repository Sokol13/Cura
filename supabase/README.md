# Cura cloud protocol

The migration installs the optional Supabase adapter's database protocol and private `cura-sync-objects` Storage bucket. Cura remains usable locally without cloud configuration. The application uses password Auth and the public/publishable key; no service-role key belongs in Cura's browser, application configuration, library export or logs.

## Deployment boundary

Apply `migrations/20261004131921_cura_sync_protocol.sql` to a Supabase project with Auth and Storage. Keep **only `public` and the normal Supabase schemas exposed to PostgREST**. Never add `cura_sync` to Data API exposed schemas. Its table grants support the public `SECURITY INVOKER` functions; exposing the private tables would bypass the RPC's CAS protocol. Every private table additionally has RLS.

The only `SECURITY DEFINER` function is private `cura_sync.my_role(uuid)`. Its subject is always `auth.uid()`, its search path is empty, and only `authenticated` can execute it. It reads membership without recursively invoking membership RLS. Authorization never uses user-editable metadata. Library ownership cannot be changed, including by its owner. Only owners change editor/viewer membership. Pending libraries are visible only to their owner until the first graph commit.

Existing broad Storage policies must not grant access to this bucket. This migration grants only member reads and owner/editor inserts at the exact path `<library UUID>/<lowercase SHA-256>`. It grants no overwrite or delete. Storage does not compute the path hash: Cura must hash every upload and verify downloaded bytes before replay; a mismatching object is an error, never accepted data.

## RPC contract

All endpoints are `POST /rest/v1/rpc/<name>`, restricted to authenticated users. Every timestamp produced by this protocol is UTC ISO 8601 with milliseconds. All revisions, commit sequences, heads and cursors are **decimal strings**, avoiding JavaScript integer rounding. UUID strings use lowercase canonical form.

| Function                   | Parameters                                                                       | Response                         |
| -------------------------- | -------------------------------------------------------------------------------- | -------------------------------- |
| `cura_sync_create_library` | `p_library_id`, `p_name`, `p_operation_id`                                       | `{library}`                      |
| `cura_sync_libraries`      | none                                                                             | `{libraries}`                    |
| `cura_sync_members`        | `p_library_id`                                                                   | `{members}`                      |
| `cura_sync_set_member`     | `p_library_id`, `p_user_id`, `p_role` (`editor`, `viewer`, or `null` to remove)  | `{members}`                      |
| `cura_sync_commit`         | `p_library_id`, `p_operation_id`, `p_changes`                                    | `{sequence,operationId,changes}` |
| `cura_sync_pull`           | `p_library_id`, `p_after` (string), `p_limit` (integer, default 20, maximum 100) | `{head,cursor,hasMore,commits}`  |
| `cura_sync_manifest`       | `p_library_id`                                                                   | `{library,sequence,records}`     |

Library: `{id,name,ownerId,role,published,head,createdAt,updatedAt}`. Member: `{userId,role,createdAt,updatedAt}`; the immutable owner is included with role `owner`. Pending owner-only libraries are returned with `published:false`.

Commit input:

```json
{
  "kind": "folder",
  "key": "84d7969a-4f71-41a1-b239-3075d7e412de",
  "expectedRevision": "0",
  "tombstone": false,
  "payload": {
    "kind": "folder",
    "id": "84d7969a-4f71-41a1-b239-3075d7e412de",
    "libraryId": "68388835-5495-48c6-9028-e8b21db42698",
    "data": {
      "id": "84d7969a-4f71-41a1-b239-3075d7e412de",
      "libraryId": "68388835-5495-48c6-9028-e8b21db42698",
      "name": "References",
      "parentId": null,
      "createdAt": "2026-10-04T00:00:00.000Z",
      "updatedAt": "2026-10-04T00:00:00.000Z"
    }
  }
}
```

`expectedRevision:"0"` requires an absent record. Tombstones require `payload:null` and retain their identity/revision. A library record cannot be tombstoned. Output records are `{kind,key,revision,payload,tombstone,createdAt,updatedAt}`; output `createdAt`/`updatedAt` are cloud envelope timestamps, independent of exact domain timestamps inside `payload.data`.

Accepted kinds: `library`, `asset`, `folder`, `tagGroup`, `tag`, `collection`, `template`, `board`, `brand`, `cmf`, `generation`, `generationJob`, `activity`, `automationJob`, `automationProposal`, `automationChange`, `archiveRule`, `scriptBreakdown`, `settingDocument`. The SQL layer validates the strict envelope, known structural library IDs and basic shape. Cura's strict portable schemas validate all domain data and graph references before replay. Arbitrary authored metadata remains opaque to SQL.

Each operation allows 1–10,000 changes and up to 16 MiB of input JSON. Every change is validated before any write. A first commit must contain the library record; bootstrap is then published atomically with the complete submitted graph. Manifests fail with `CURA_SYNC_LIMIT` above 10,000 records or 16 MiB, never return a truncated graph. Pulls return complete commit groups with up to 32 MiB of change JSON; the cursor advances only through those complete groups. A manifest and its sequence share one read snapshot.

`operationId` is durable and scoped to its library. Exact retries return the original acknowledgment even after later commits. Reusing it with a changed body or actor fails with `CURA_SYNC_OPERATION_MISMATCH`. Create retries likewise require the original operation ID, owner and name. The server hashes PostgreSQL's canonical `jsonb` serialization; clients must not attempt to reproduce that hash. Clients store their own portable/semantic hashes separately.

Conflicts produce HTTP 400 with `message:"CURA_SYNC_CONFLICT"` and `details` containing a JSON string of `{kind,key,expectedRevision,actualRevision,record}`. No part of a rejected operation is written. Other stable messages include `CURA_SYNC_FORBIDDEN`, `CURA_SYNC_INVALID_ENVELOPE`, `CURA_SYNC_INVALID_PAYLOAD`, `CURA_SYNC_CROSS_LIBRARY`, `CURA_SYNC_DUPLICATE_KEY`, `CURA_SYNC_INVALID_CURSOR`, `CURA_SYNC_BOOTSTRAP_REQUIRED`, and `CURA_SYNC_LIMIT`. Clients parse messages; raw SQL errors must not be shown as successful syncs.

The library row is locked before CAS checks and before incrementing its transactional sequence. Committed sequence order therefore matches visibility order; a cursor cannot skip a lower uncommitted transaction. Membership changes share that lock. A revoked writer cannot replay an old acknowledgment or submit a new commit.

## Reproducible local verification

Use pinned Supabase CLI **2.119.0** and a disposable local Docker stack. Initialize/start it using that CLI's documented `init` and `start` commands, with email confirmation disabled for test signup and `cura_sync` excluded from exposed schemas. Capture `supabase status -o json` into a private file (`chmod 600`); it contains local credentials and must never be committed or printed. These tests use only its `API_URL` and `ANON_KEY`.

```sh
CURA_SYNC_TEST_STATUS=/absolute/private/status.json \
CURA_SYNC_TEST_CONTAINER=supabase_db_your-local-project \
pnpm --filter @cura/server exec vitest run test/sync-cloud.test.ts
```

The suite refuses non-loopback URLs. It drops/recreates only `cura_sync` and its two named Storage policies, then reapplies the checked-in migration through `psql`. It does not reset Auth, other schemas, buckets or unrelated data. It creates isolated random test accounts and object prefixes. Do not run it while application sync uses the same disposable stack. Without the explicit environment variable the suite is skipped, so ordinary offline tests do not require Docker or cloud credentials.

Coverage includes actual Auth login/refresh; anonymous/outsider isolation; owner/editor/viewer permissions and revocation; owner immutability; direct REST table denial; hidden bootstrap; strict envelopes and cross-library rejection; atomic stale-CAS rejection; identical retry and changed-request rejection; concurrent commit ordering; complete commit pagination; tombstones; exact immutable private object bytes and rejected overwrites; local-scope sign-out. Run `supabase db advisors --local --type security --level warn --fail-on warn` after schema changes. Hosted project deployment and user-specific Auth configuration remain separate from this local verification.

Verified on 2026-10-04 against the real disposable local stack: all **11 integration scenarios passed** in 4.6 seconds, including a writer blocked behind concurrent revocation. Server TypeScript, scoped ESLint/Prettier and the Supabase security advisor passed with zero warning-level findings. The stack used CLI 2.119.0 and PostgreSQL 17.11; no hosted project was modified.
