# v0.3.0 implementation plan

Prepared during P1 acceptance; implementation starts after the verified v0.2.0 tag/report. The user authorizes continued autonomous work, no questions, main pushes per completed task and incoming desktop bug priority. No P2 omission is currently justified. Missing hosted credentials are a verification boundary, not a reason to stop local development.

## Ownership and integration

Three complete slices can proceed in parallel. Coordinator owns shared exports, migration journal, App navigation, catalog display/archive integration, neutral-export additions, shutdown order and release gates. Module owners supply typed contracts, local APIs, bilingual lazy workspaces, tests and scoped commits. Keep originals, source aliases and immutable version bytes unchanged.

- `0006_automation.sql`: automation jobs/changes, archive rules, script breakdowns and setting documents. Module paths `shared/automation.ts`, `server/automation/*`, `web/automation/*`.
- `0007_sync.sql`: local sync state, baseline/cursors/conflicts and pending operations. Module paths `shared/sync.ts`, `server/sync/*`, `web/sync/*`, `supabase/*`.
- `0008_fcpxml.sql`: persisted FCPXML export jobs. Module paths `shared/fcpxml.ts`, `server/fcpxml/*`, `web/fcpxml/*`.

Every record has UUID identity and created/updated timestamps. Domain mutations use transactions, library ownership and strict shared schemas. No active jobs, credentials or device-specific cache paths enter portable exports or cloud records.

## Automation and creative documents

1. Define `VisionProvider` and a usable configured HTTP implementation accepting image input and structured output. Keep URL/model/key server-side. Validate the production adapter against a loopback protocol fixture; label the fixture test-only. Attempt a real local CPU vision-model probe if available. Offline metadata rules must be labeled rules, not a visual model.
2. Analyze into persisted per-asset proposals, then let users apply selected proposals. Record exact before/after fields and expected current version/values. Undo only unchanged applied fields; preserve intervening user edits and report conflicts. Handle cancellation, malformed output, timeouts and partial failures explicitly.
3. Naming changes a nullable catalog `displayName`, never physical source names or historical version names. Normalize NFC, reject portable reserved/path characters, preserve extensions for exports and resolve collisions deterministically. Include display names in FTS, UI and portable records.
4. Saved rules logically archive through nullable `archivedAt`; provide archive view/restore. Rules may filter age, folder/tags/rating. Exclude any asset referenced by an active final selection, including historical slot pins. Repeated runs are idempotent. New final assignment restores an archived asset.
5. Accept bounded UTF-8 text, Markdown and Fountain scripts, retaining the original as an immutable version. A labeled offline structured parser extracts scene headings, character cues and explicit prop markers; configured text-capable providers can handle unstructured prose. Store editable character/prop/scene lists with validated line references and exact excerpts.
6. Generate editable Markdown setting documents from exact version pins, metadata, notes, prompts and references. Distinguish missing information and model suggestions. Export Markdown plus structured JSON.
7. Verify stale proposals, selective undo, original bytes/names, NFC/collisions, historical-final archive protection, idempotence, provider errors/cancellation, bilingual script references and document export. Real-server E2E covers review/apply/undo and complete document flows.

## Optional Supabase authentication and sync

1. Load the Supabase skill before implementation. Candidate pinned packages: `@supabase/supabase-js` 2.117.2 (MIT, Node >=22) and development CLI 2.119.0 (MIT); audit installed transitive licenses. Docker 28.4.0 is available, permitting a disposable local Supabase stack with real Auth/PostgREST/Storage/RLS and generated local credentials. Do not mutate a hosted project.
2. Server owns password sign-in, refresh and local-scope sign-out. Store refresh state in a private user-data file excluded from diagnostics/exports. Browser receives readiness/account status only. No configuration means explicit local mode; offline/expired/revoked access suspends sync while retaining pending work.
3. Cloud tables: libraries/immutable owner, explicit UUID members with editor/viewer roles, typed portable records with revisions/tombstones/monotonic sequence. Use a private content-addressed bucket at `<libraryId>/<sha256>`. Owner manages membership; editors mutate/upload; viewers read/download. Copying account UUIDs avoids a mail/admin dependency.
4. Portable aggregates cover assets/versions/annotations/tag links, boards/slots/history/templates, brands/CMF, organization, process metadata and completed automation/documents. Roots/watch registrations/cache/preview state and active jobs remain device-local. Incoming bytes materialize into a managed local root without changing portable identity/hash.
5. Reuse the consistent neutral-export readers. Hash portable aggregates against persisted baselines to find additions, modifications and hard-deletion tombstones. Do heavy snapshot/hash work off the API thread. Transfer changed aggregates and missing content hashes only.
6. Use transactional batch/CAS operations with stable operation IDs. Verify/upload content before publishing record changes. Pull bounded sequence pages, validate schemas/hashes/ownership, stage dependencies, apply atomically and only then advance the cursor. Interrupted work/retries must not duplicate generations or graph records.
7. Keep both local/remote conflicting snapshots in conflict records. Local pending edits win against refreshed remote revisions. Remote materialization must not echo as a fresh local edit. Test with two independent local data directories.
8. Enable RLS on every exposed table and Storage object, plus explicit authenticated grants. Never authorize from editable JWT metadata. Avoid recursive membership policies. Application RPCs use security invoker, revoked public execution and bounded validation. Updates need both USING and WITH CHECK. Immutable storage uploads use `upsert: false`; retries verify existing bytes before acceptance.
9. Create migration filenames through the CLI's actual `migration new` command. Verify from a clean reset and run advisors. Test real local login/refresh/sign-out; anonymous/outsider/owner/editor/viewer matrix; ownership reassignment and cross-library rejection; initial/incremental two-device sync; local-wins conflict; restart/offline/deletion/revocation; full P1 graph round-trip and secret exclusion. Add browser cloud-control E2E. Hosted deployment remains unverified until configured and tested there.

## FCPXML timelines

1. Accept an explicitly ordered list of exact version pins, durations/in-points and timebase. Board import creates editable sequence order; canvas coordinates do not imply narrative order.
2. Implement a documented FCPXML 1.7 subset for stills and supported video using Apple's official DTD. Use rational seconds/BigInt, frame-aligned offsets, stable references and escaped Unicode/XML. Do not mix syntax from newer versions.
3. Probe video timing or require explicit validated source timing; never invent it. Images have a visible editable default duration. Missing/unsupported media and invalid timing fail with per-clip guidance.
4. Materialize retained bytes into a stable user-data export directory with readable names/extensions. `pathToFileURL` generates working URLs for the machine running Cura. Also export ZIP/XML/media/manifest plus a relink utility for transfer to another machine; do not call internal Linux snapshot paths portable.
5. Independently validate against Apple's DTD, references, total duration, 24/25/30 and 24000/1001 timebases, multiple clips, Unicode, historical hashes, failures and moved-package relinking. Browser E2E covers ordering/duration/download. Actual Final Cut Pro import remains a macOS smoke step.

## Release gate

For each complete integrated task: update progress/decisions, lint/typecheck/unit/E2E, main push and observe green CI. Perform one independent P2 review, fix demonstrated defects, rerun all P0/P1 gates and verify clean startup. Each P2 item is complete and tested or explicitly omitted with a concrete reason. Write REPORT-v0.3.0, update SMOKE_TEST/README/CHANGELOG, check every inherited definition, then tag/verify Release and report. Stop only under AGENTS.md section 1.

## References

- [Supabase skill](skill://plugin_asdk_app_69d3e5ee6a708191baa733f7b8931995/supabase/SKILL.md)
- [Explicit Data API grants](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
- [Password sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithpassword), [sign-out scope](https://supabase.com/docs/reference/javascript/auth-signout), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Apple FCPXML 1.7 DTD](https://developer.apple.com/library/archive/documentation/Miscellaneous/Conceptual/LegacyDTDsFinalCutPro/FCPXMLDTDv1.7/FCPXMLDTDv1.7.html)

## Reviewed sync integration details

Research during P1 acceptance resolved these boundaries before implementation:

- `0007_sync` adds a private `library_roots.managed` flag and a partial unique index allowing one active managed root per library. Keep the existing root-kind constraint. Core root-list/get/delete paths hide or reject managed roots, which therefore never enter watcher startup/rescans. A retained incoming asset with an active managed primary root is available without synthetic source aliases. Existing aliases, original paths and source `last_hash` values remain untouched.
- Expose `CatalogStore.refreshAssetSearch(assetIds: readonly string[]): void` as a transaction-safe index refresh without timestamps, activity or identity changes. Replay uses dedicated validated SQL; ordinary create/ingest/slot/brand APIs cannot preserve imported IDs and history.
- Keep received library bootstrap staged outside visible `libraries` until the complete graph, verified objects and managed root can commit together. Owner-created preset template IDs must be published first; receiver UI must not seed conflicting random preset identities.
- Separate portable fields from operational fields through strict typed aggregate schemas. Ingest activity's `relativePath` is device-local; user-authored metadata strings remain exact. Use semantic hashes plus acknowledged portable timestamps so preview/source/projection updates do not echo as new edits.
- Acknowledgment baselines record the exact submitted hashes, not current state after a response. Recheck live local hashes inside replay's transaction. Preserve complete union of conflicting retained version/slot-history identities; deterministic ordinal remaps are recorded. If a local-winning slot pin differs from the last merged history pin, append an idempotent resolution revision derived from operation/slot IDs, preserving all original revisions.
- Put cloud persistence in an unexposed schema with explicit grants and RLS; expose bounded SECURITY INVOKER RPCs. Use an auth.uid-bound private membership helper to avoid recursive RLS. Serialize commit sequence allocation under a per-library lock; an uncoordinated bigserial can allocate before commit and let a pull cursor skip an earlier transaction. Operation IDs plus request hashes make retries idempotent. Pull and apply complete transaction batches before advancing cursors.

## Genuine local vision probe

A development-only CPU probe outside the repository ran Apache-2.0 `HuggingFaceTB/SmolVLM-256M-Instruct` at revision `7e3e67edbbed1bf9888184d9df282b700a323964`. Its real inline-image HTTP response correctly described the synthetic red house with a blue roof in about two seconds. JSON, comma-tag, filename and labelled-field prompts did not produce compliant structured output and sometimes hallucinated details. Preserve these limits; do not call those responses successful structured inference.

Implement a strict JSON provider mode that rejects malformed output, plus an explicitly labelled caption mode if using this actual small model for an end-to-end proposal. Caption mode retains the raw model caption and derives conservative controlled-vocabulary tags and a normalized descriptive display name through a documented deterministic rule. Record model and derivation provenance separately. Both modes produce reviewable proposals; neither directly overwrites metadata or originals. This avoids fabricating model-supplied JSON while providing a usable path for a genuine locally verified visual model. Model weights and Python tools remain external development/provider prerequisites, not Cura runtime dependencies.
