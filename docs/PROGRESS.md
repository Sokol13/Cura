# Progress

## Current status

All three requested milestones are published. AGENTS.md section 1(a), **all three milestones achieved**, is satisfied. The user authorized uninterrupted implementation, main publication and milestone tags without questions; decisions and resolved findings remain in DECISIONS.md and the reports. Incoming macOS/Windows smoke-test bugs take priority over any future feature work.

## Completed milestones

| Milestone                                                     | Published tag target | Verified result                                                                                                                                                                                                                            |
| ------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [v0.1.0](https://github.com/Sokol13/Cura/releases/tag/v0.1.0) | `c564361`            | All nine P0 definitions; 170 units and 9 browser scenarios. Implementation CI 37198719712, final documentation CI 37198939724, tag CI 37199147410 and Release 37199147287 succeeded.                                                       |
| [v0.2.0](https://github.com/Sokol13/Cura/releases/tag/v0.2.0) | `5719552`            | All inherited gates and complete P1; 262 units and 21 browser scenarios. Implementation CI 37204410094, final documentation CI 37204693234, tag CI 37205042438 and Release 37205042369 succeeded.                                          |
| [v0.3.0](https://github.com/Sokol13/Cura/releases/tag/v0.3.0) | `d90a567`            | All inherited gates and all three P2 groups; 434 unit/tool tests, 17 actual cloud integration tests, 27 ordinary browser scenarios and one actual two-device cloud browser scenario. CI 37211290714 and publication 37211646421 succeeded. |

Each release was reported in chat; work continued immediately after v0.1 and v0.2. The final v0.3 annotated tag and stable, non-draft GitHub Release were independently verified after publication at 2026-10-04 15:04:43 UTC.

## Final v0.3 evidence

- Complete automation review/apply/selective undo, display names, bounded archive rules, retained scripts and setting documents; genuine pinned visual-model inference with exact provenance and limitations.
- Optional server-owned Supabase sessions, immutable verified bytes, complete portable P0/P1/completed-automation graph transfer, incremental durable retries, local-wins conflict snapshots and owner/editor/viewer team libraries. Real Auth/RLS/Storage, corruption/recovery, security advisors and two-device browser acceptance passed locally and in mandatory CI with no skipped cloud cases.
- FCPXML 1.7 exact historical timelines, rational timing, video inspection, board import, retained-media ZIPs and relocation/relink; independent official Apple DTD and hash/timing validation passed.
- Final 1,000-image ingestion took 11.74 seconds; all thumbnails decoded. Seventy queries peaked at 53.1 ms; browser search was 100.9–115.4 ms; watched assets appeared in 875 ms. Grid frame p95 was 16.8 ms. Separate 10,000-record UI virtualization passed; it is not a 10,000-image ingestion claim.
- Independent clean clone of frozen runtime source `41e45b1`: install 2.4 seconds; normal automatic-browser startup 24.4 seconds; Chinese library creation, reload and closed-database persistence passed. Exact production package trees remain identical to the published tag. Real v0.2 upgrade passed 17 checks across all 36 legacy tables, retained hashes and two idempotent reopens.
- Browser artifact audit: 196 files, 4,351,021 bytes and 159 permitted runtime dependency groups. Pinned PDF worker/CMaps/notices match; optional canvas is absent. Detailed evidence is retained separately for each version.
- Independent reviews found and fixed archive batching, full tag labels, EXIF orientation, stale timeline selection, sync cycles/closure/replay ordering and cloud restoration blocking local startup. No known reproducible implementation defect remains open.
- CI 37210844246 correctly blocked the first final request on a 267.24 ms archive heartbeat under concurrent unit workloads. The root test command now runs the same three cases after other unit workers finish with all original thresholds. Corrected local tests and release CI 37211290714 passed. Production package trees, lockfile and startup behavior were unchanged.

## Repository and process state

- Published tag: `d90a567fbfe8989241bce8e65db27ffc31640c66`; annotated tag object: `0277bd8f69992341c24ea7c54879747a6c3579e6`.
- [Release CI](https://github.com/Sokol13/Cura/actions/runs/37211290714), [publication workflow](https://github.com/Sokol13/Cura/actions/runs/37211646421), [latest main CI](https://github.com/Sokol13/Cura/actions/workflows/ci.yml?query=branch%3Amain). The final progress/documentation commit runs the same complete CI; final chat completion follows its successful result.
- The consumed `.github/release-request.json` is removed. The fallback is inactive for subsequent main commits. No existing tag was moved or forced.
- Connected GitHub app publication worked around the expired shell credential by verifying exact Git tree equality and advancing main without force. Local main and the integration checkout are synchronized after each publication.
- All owned Cura servers, the development vision model and local Supabase containers were stopped. Verified closed ports: 4318, 4320, 4321, 4342, 54321, 54322 and 8898. Source, installed clean clone, reports and reproducible evidence remain available.

## Remaining verification boundaries

Physical macOS/Windows, hosted Supabase configuration and Final Cut Pro application import are not claimed. Follow [SMOKE_TEST.md](SMOKE_TEST.md); it includes core ten-minute checks and optional cloud/model/FCP follow-up. These are documented platform/provider boundaries, not unfinished P2 implementations.

## Next / resume

No planned implementation task remains. Stop under section 1(a) after verifying final-main CI. For a new user-reported failure, read AGENTS.md, this file and the relevant report; run the documented environment setup, inspect current main/status, reproduce the first failure and prioritize its fix. Do not recreate already completed milestones. Evidence lives under docs/evidence/v0.1.0/, v0.2.0/ and v0.3.0/.
