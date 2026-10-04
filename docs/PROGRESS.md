# Progress

## Active scope

The user accepted phase 0 on 2026-10-04 and authorized uninterrupted development through v0.1.0, v0.2.0 and v0.3.0. Do not ask questions. Record decisions in DECISIONS.md. Incoming macOS/Windows smoke-test bugs take priority. Stop only under AGENTS.md section 1.

## Completed

- Phase 0 and published v0.0.1; phase-1 research, PRD, architecture and task plan.
- P0 media workers, immutable snapshots, metadata extraction, catalog persistence, local APIs, filesystem watching and full asset-library UI are integrated and pushed to main.
- Independent review fixes verified: unavailable-source/rename lineage, preserved generation edits in versions, safe partial updates, per-file upload failures, similarity availability, live previews, retained diagnostics, cache management, annotation editing and adjacent navigation.
- Final complete local gate passed: lint, typecheck, 127 server + 43 web unit tests, and all 9 real-server Chromium E2Es (59.6 seconds after the native static-serving replacement).
- Actual 1,000-image stress: all thumbnails decoded, 70 queries/filters worst 52.1 ms; browser search 93.5–105.6 ms; new file visible after 884 ms; no external requests. Six-format previews pass. Separate synthetic 10,000-record browser virtualization passes (not a 10,000-image ingestion claim).
- Fresh clone/install/start passed with Node 22/pnpm 10 and native prebuilt binaries. The normal default-browser opener launched headless Chromium through isolated Linux desktop associations; the Chinese UI created a library and retained it after reload. Physical macOS/Windows remain user smoke checks.
- Final implementation `8cec733` passed [CI 37198719712](https://github.com/Sokol13/Cura/actions/runs/37198719712); watch exited zero and all 9 E2Es passed without retries. The full production license graph is checked automatically; the optional BlueOak static-plugin tree was removed.
- Renewed clean clone at `8cec733`: frozen install (1.6 seconds), verified prebuilts/license check, automatic headless-browser launch through Linux default associations, Chinese library creation and persistence all passed.

- Published [v0.1.0](https://github.com/Sokol13/Cura/releases/tag/v0.1.0) at `c564361` after all nine definitions passed. Final documentation CI 37198939724, tag CI 37199147410 and Release workflow 37199147287 all completed successfully. Reported the milestone in chat and immediately continued P1.

## v0.2 acceptance and tag

- All P0/P1 implementations and independent review corrections are complete. Main 44c53a7 passed CI 37204410094; final evidence/documentation commit 5719552 passed CI 37204693234. Both runs passed all 262 units (167 server + 95 web) and 21 real-server browser scenarios. Every acceptance row in REPORT-v0.2.0.md passes.
- Annotated tag v0.2.0 points at 5719552 and is pushed. Reported the milestone in chat and immediately began P2. [Release workflow 37205042369](https://github.com/Sokol13/Cura/actions/runs/37205042369) and [tag CI 37205042438](https://github.com/Sokol13/Cura/actions/runs/37205042438) both passed. [GitHub v0.2.0](https://github.com/Sokol13/Cura/releases/tag/v0.2.0) is published (2026-10-04 13:20 UTC).
- Final Linux acceptance: 1,000 distinct image ingestion 10.07 seconds, all thumbnails decoded, 70 queries at most 56.4 ms, browser search 93.9–103.4 ms, watched asset 874 ms, scroll frame p95 16.8 ms. Synthetic 10,000-record UI virtualization also passed. Physical Mac/Windows checks remain in SMOKE_TEST.md.
- Clean clone at exact production source 179ec28 passed frozen install in 1.9 seconds, native prebuilts, NODE_PATH-empty resolution without optional canvas, automatic default-browser opening and Chinese library persistence. Source-tree hashes match the tag. Real v0.1 upgrade and 190-file browser audit are retained under evidence/v0.2.0/.

## P2 foundation checkpoint

- Integrated all three shared contracts and migrations (nine total), logical display names/archive controls, guarded final-selection restoration, managed cloud roots, FTS refresh and portable metadata/dependency closure. Original filenames and retained version bytes remain unchanged.
- Automation server routes, bounded worker processing, persisted proposal/apply/undo history, script references/documents and scheduled rules are integrated. A genuine pinned local SmolVLM model completed production caption-to-proposal/apply/undo; malformed strict JSON was correctly rejected. Exact raw evidence and limitations are under evidence/v0.3.0/vision/.
- FCPXML server exports support ordered historical pins, rational timing, retained-media packages and relinking. Independent official Apple 1.7 DTD validation is a pinned development/CI prerequisite; it is not distributed or required at runtime.
- Supabase cloud SQL/RLS and strict portable graph/replay/merge foundations are integrated. Eleven separately executed real local Auth/PostgREST/Storage tests passed. These tests remain explicitly skipped in the default suite without a private local fixture; no hosted deployment is claimed.
- Full integrated foundation gate at 21dc4fd passed lint, typecheck, 342 unit tests (226 server + 116 web), and all 22 real-server Chromium E2Es in 2.0 minutes. This includes every inherited P0/P1 scenario and the new display-name/archive scenario. Heavy parallel workloads were paused during browser performance acceptance.
- Independent review found a catalog/automation tag-limit mismatch. A scoped fix now retains valid 255-character catalog tag labels in proposal history and setting documents; two new integration regressions and all 14 affected tests pass. The complete foundation gate above predates this narrowly scoped fix. Review also identified a measurable archive event-loop delay at 1,000 assets; bounded asynchronous processing subsequently fixed it and passed the final acceptance gate below.
- Foundation publication uses the connected GitHub app because the shell token expired; exact Git tree equality and non-force main advancement are verified. Published foundation main e0efb4b passed CI 37207974648. The published foundation kept new workspaces out of navigation; the next integration now connects all three complete workspaces.

## P2 candidate integration

- Root has integrated the full automation, FCPXML and cloud workspaces, server sync lifecycle, exact-version preview rebuilds and all scoped acceptance commits. Real configured cloud browser acceptance passed in 32.4 seconds using fresh private accounts and two Cura instances; the no-config browser path also passed. All active test servers from those runs were cleaned up.
- Independent corrections are integrated: full tag labels, bounded archive batches, EXIF-oriented JPEGs, hidden stale picker selection, concurrent hierarchy cycles, dangling board references and replay ordering/timestamps. Real corrupted-graph/object tests keep catalog bytes and sync cursors unchanged; metadata-only/preview-only transfer bounds pass.
- Full local candidate lint/type/unit gate at 53cf8d2 passed 271 server + 136 web + 4 private-fixture-tool tests (411 total), with 17 separately configured cloud cases skipped in the default suite. The combined four automation/FCPXML browser flows also passed after central navigation integration. The frozen final source at `41e45b1` passes 434 default unit/tool tests (277 server + 136 web + 21 tools), 17 actual cloud tests, all 27 default browser scenarios (2.4 minutes) and one configured two-device browser scenario (27.8 seconds). The startup correction is integrated at `891f25f`: local listener startup does not await cloud validation, and shutdown aborts/drains authentication before closing SQLite; six real HTTP/lifecycle regressions pass.
- Real v0.2 upgrade passed 17 preservation checks across all 36 legacy tables, six-to-nine migrations, retained file hashes and two unchanged reopens. Reproducible evidence records exact source `41e45b1`. An independent clean clone of the same source passed frozen install (2.4 seconds), normal automatic-browser startup (24.4 seconds), Chinese library creation and restart persistence. Browser license inventory verified 196 emitted files, 4,351,021 bytes and 159 allowed runtime dependency groups.
- Four package versions now declare 0.3.0 as a release candidate. REPORT-v0.3.0.md explicitly lists pending gates; no release request or tag exists. Mandatory real local Supabase CI is implemented and will count only after actual remote success. The independently reviewed release fallback remains inactive until every milestone gate passes; its 12 guard/recovery tests pass.

## v0.3 final acceptance

- Complete candidate `1f24a5b` is published on main and passed [CI 37210499373](https://github.com/Sokol13/Cura/actions/runs/37210499373). Both jobs succeeded: lint/types, 434 default unit/tool tests and 27 ordinary browser scenarios; 17 genuine Supabase integration tests, security advisors and the configured two-device browser scenario. No cloud case was skipped in its required job.
- All nine inherited P0 definitions, all P1 criteria and all three P2 capability groups pass. Final independent review found no remaining material defect. REPORT-v0.3.0.md records the checklist, exact package trees, local clean-start/upgrade/performance/model evidence and physical/hosted limits.
- Final documentation and the explicit release request are prepared. The automated fallback can create the annotated tag and GitHub Release only after this exact request commit passes full CI and remains main. Existing tags cannot be moved.

## In progress

- Final request `e530e4f` correctly did not publish: CI 37210844246 failed one archive heartbeat measurement under concurrent unit workloads (267.24 ms versus 250 ms). The root test command now isolates the unchanged three-case performance suite after other units, preserving all thresholds/counts and all production package trees. The corrected local lint/typecheck and all 434 unit/tool tests pass, including all three unchanged archive cases in the isolated invocation. The full remote gate remains required before publication. The connected GitHub app provides exact-tree non-force main publication while the shell credential is expired.

## Next

1. Observe complete final-request CI and the gated release job.
2. Verify v0.3.0 tag/Release, remove the consumed request, publish final progress and verify green latest-main CI.
3. Stop owned development processes. Once all three published milestones are verified, stop under AGENTS.md section 1(a). Incoming desktop bugs take priority.

## Resume

Read AGENTS.md, this file and TASKS.md. Mandatory environment setup already succeeded in this session. On a new session run scripts/codex-setup.sh with docs/CODEX_ENV.md exports; .tmp/env.sh is an untracked convenience. Inspect git status/log and active worktrees before editing. Preserve user changes and integrate only completed, tested agent commits. Each milestone retains its own performance, clean-start and upgrade evidence under docs/evidence/v0.1.0/, v0.2.0/ and v0.3.0/.
