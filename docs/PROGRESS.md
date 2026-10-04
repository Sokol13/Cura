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

## In progress

- P1 integration is at `/tmp/cura-p1` (`feat-p1`); the shared persistence/API foundation is already on main (`fd850d6`, green CI 37200089559). All boards, brand/CMF, rich-preview, process and neutral-export slices are integrated, including independent review corrections.
- Final full local gate passed lint, typecheck, 262 unit tests (167 server + 95 web) and all 20 real-server E2Es in one run (1.9 minutes, no retries). This includes strict 1,000-image performance/offline, six formats and synthetic 10,000-record rendering. Three inherited test assumptions were corrected for revision URLs and global cache counts; no performance threshold changed. Evidence is retained under evidence/v0.2.0/.
- Actual released v0.1 services populated a legacy database and P1 migrated it from three to six migrations. All original identities, timestamps, fields, uint64 seeds, annotations, final selections and retained/original hashes survived; generation/final-owner backfills, new historical pins and two idempotent reopens passed. See UPGRADES.md and evidence/v0.2.0/upgrade.json.
- Implementation 6a6010c is pushed to main. CI 37202248867 exposed a PDF unit-test dependency on an optional/global Node canvas and a watched-preview unit timeout. Browser PDF verification is being retained in E2E without that dependency; the watcher unit now uses deterministic application timers. Product source is unchanged. Do not tag until fresh verification and replacement CI pass.
- v0.2 release documentation and smoke checklist are drafted. The final 190-file browser bundle audit matches every output hash. Fresh clone/install/default-browser startup and main CI remain required before tagging.
- P2 design is in P2-IMPLEMENTATION.md. A disposable real local Supabase stack has verified Auth/refresh/RLS/private Storage and needs no user credentials; containers remain paused during performance acceptance. P2 feature implementation starts after v0.2 publication/report.

## Next

1. Integrate and verify P1 persistence, APIs, lazy workspace navigation and browser preview workers; complete TASKS.md tasks 7–9.
2. Push each completed integrated task to main with current progress and observe CI. Incoming Mac/Windows smoke bugs take priority.
3. Complete and publish v0.2.0, then P2/task 10 and v0.3.0. Do not stop at an intermediate milestone.

## Resume

Read AGENTS.md, this file and TASKS.md. Mandatory environment setup already succeeded in this session. On a new session run scripts/codex-setup.sh with docs/CODEX_ENV.md exports; .tmp/env.sh is an untracked convenience. Inspect git status/log and active worktrees before editing. Preserve user changes and integrate only completed, tested agent commits. Performance and clean-start evidence is under docs/evidence/v0.1.0/.
