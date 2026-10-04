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

## In progress

- P2 root integration is `/workspace/cura-p2` (`feat-p2`), starting from v0.2.0. Detailed plan: P2-IMPLEMENTATION.md. No P2 omission is justified; missing hosted credentials do not block the disposable real local Supabase acceptance stack.
- Automation server/contracts/0006: `/workspace/cura-p2-automation`; automation UI: `/workspace/cura-p2-automation-ui`. Implement genuine configured vision proposals with explicit JSON/caption modes, guarded apply/undo, logical archive rules, retained script breakdowns and exact-version setting documents. Genuine Apache-2.0 CPU vision inference is available outside Cura's runtime.
- Supabase server/contracts/0007: `/workspace/cura-p2-sync`; cloud UI: `/workspace/cura-p2-sync-ui`. Implement private server sessions, complete incremental graph transfer, verified immutable bytes, durable local-wins conflict handling and team RLS against the disposable real local stack.
- FCPXML contracts/0008/server/UI: `/workspace/cura-p2-fcpxml`. Implement explicit ordered exact-version timelines, rational frame timing, retained-media package/relink and independent official DTD validation.
- Coordinator owns catalog display names/archive controls, private managed roots, FTS refresh, shared exports/migration journal, navigation, portable export additions and release gates. Separate module branches supply scoped tested commits for integration.

## Next

1. Complete the shared P2 contracts and catalog integration hooks.
2. Integrate P2 contracts/migrations and core catalog hooks; run the complete foundation gate, push main and verify CI. Keep progress current for every completed task.
3. Finish each complete P2 slice, real provider/Supabase/DTD/browser acceptance, independent review and all inherited gates. Publish v0.3.0 only after every implemented item is complete. Incoming desktop bugs take priority.

## Resume

Read AGENTS.md, this file and TASKS.md. Mandatory environment setup already succeeded in this session. On a new session run scripts/codex-setup.sh with docs/CODEX_ENV.md exports; .tmp/env.sh is an untracked convenience. Inspect git status/log and active worktrees before editing. Preserve user changes and integrate only completed, tested agent commits. Performance and clean-start evidence is under docs/evidence/v0.1.0/.
