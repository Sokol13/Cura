# Progress

## Active scope

The user accepted phase 0 on 2026-10-04 and authorized continuous autonomous development through AGENTS.md phases 1–4. Do not stop at v0.1.0; continue to v0.2.0 and v0.3.0 until an explicit section-1 stopping condition applies. Incoming macOS/Windows smoke-test bugs take priority. Decisions are recorded in DECISIONS.md.

## Completed

- Phase 0 and published v0.0.1 remain complete; see REPORT-v0.0.1.md.
- Read complete AGENTS.md, prior progress and decisions; fetched origin and resumed main at `68c38ee`.
- Confirmed GitHub authentication and repository fetch work.
- Selected the retained Node 22/pnpm 10 toolchain after the default shell exposed Node 24/pnpm 11.

## In progress

- Phase 1 documents integrated and independently reviewed: RESEARCH.md, PRD.md, ARCHITECTURE.md and TASKS.md. Final local gate passed (25 unit tests, 1 E2E). Pushed `56433f2`; [GitHub CI 37194418005](https://github.com/Sokol13/Cura/actions/runs/37194418005) succeeded and `gh run watch --exit-status` confirmed it.
- Task 2 media primitives integrated as `37b0c54`; full local lint/typecheck/test/e2e passed (81 unit tests including 55 media tests, 1 real-server E2E). Publishing with this update.
- Task 3 persistence integrated at `fc69f20`; full local lint/typecheck/test/e2e passed (94 unit tests, 1 E2E), including metadata/path/media and persistence suites. [CI37195454257](https://github.com/Sokol13/Cura/actions/runs/37195454257) is green.
- runtime APIs in feat-runtime (/tmp/cura-runtime); Task 5 UI in feat-web (/tmp/cura-web); preview in feat-preview; stress fixtures in feat-stress. Integration belongs to coordinator.
- P0 dependency/startup preparation pushed as `3473fb4`; [CI 37194568281](https://github.com/Sokol13/Cura/actions/runs/37194568281) is green. It passed full local gate (25 unit tests, 1 E2E): audited npm licenses, pinned Sharp/exifr/chokidar/WebSocket/fflate/Zustand/Virtual; native Sharp encode/decode verified; start now builds before launch.
- Mandatory setup succeeded with Node 22.23.3 / pnpm 10.34.6; the provisioned Chromium launch succeeded. Root-only Playwright OS-package installation used the documented fallback.
- Baseline quality gate passed: lint, typecheck, 25 unit tests and 1 real-server E2E.
- Independent architecture review findings were incorporated: alias divergence, stable snapshots, active-file response headers, CJK substring search, organization mutation contracts, full offline workflow and platform error cases.
- No milestone claims or new tags have been made.

- Shared Zod catalog contracts integrated at `b4e6d25`; full local gate passed (26 unit tests, 1 E2E). [GitHub CI 37194854424](https://github.com/Sokol13/Cura/actions/runs/37194854424) is green after the progress commit `9e5c84c`.
- Runtime/worker integration under /tmp/cura-runtime branch feat-runtime. First real-ingestion integration test fails as expected on missing API (404 versus 201), before implementation.

## Current integration checkpoint

- `/tmp/cura-runtime` (`feat-runtime`) contains actual local APIs/worker/watchers, full three-column UI, preview/annotation/compare, generated fixtures and P0 documentation. Main retains the last complete green module checkpoint until integration gate passes.
- Real ingestion/organization/security/diagnostic tests pass; two offline preview E2Es and two real catalog workflow E2Es pass in isolated integrated snapshots.
- 1,000 generated images ingested successfully; all thumbnails and 70 search/filter requests passed the first stress phases. Final UI stress is rerunning after fixing partial-settings defaults; it is NOT yet claimed passed.
- Independent review fix pass: source rename/delete availability, corrected metadata in version history, unsupported similarity handling, preview navigation/annotation editing, cache controls and retained diagnostic errors. These block release until tests pass.
- No v0.1.0 tag exists yet. Clean-clone startup, complete final suite, release checklist and remote CI are still required. Do not skip these on resume.

## Next

1. Integrate phase-1 documents; self-check feature coverage; run lint, typecheck, tests and real-server E2E; commit and push main, observe CI.
2. Execute TASKS.md P0 tasks with shared API contracts and independent module worktrees.
3. Check all nine v0.1.0 completion definitions before reports, tag and release; continue P1 immediately afterward.

## Resume instructions

Read AGENTS.md, this file and TASKS.md. Run scripts/codex-setup.sh using docs/CODEX_ENV.md toolchain exports. Inspect git status/log and active worktrees before editing. `.tmp/env.sh` is untracked convenience for the current container only. Preserve user changes and integrate only completed, tested agent commits.
