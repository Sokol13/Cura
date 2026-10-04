# Progress

## Active scope

The user accepted phase 0 on 2026-10-04 and authorized uninterrupted development through v0.1.0, v0.2.0 and v0.3.0. Do not ask questions. Record decisions in DECISIONS.md. Incoming macOS/Windows smoke-test bugs take priority. Stop only under AGENTS.md section 1.

## Completed

- Phase 0 and published v0.0.1; phase-1 research, PRD, architecture and task plan.
- P0 media workers, immutable snapshots, metadata extraction, catalog persistence, local APIs, filesystem watching and full asset-library UI are integrated on feat-runtime.
- Independent review fixes verified: unavailable-source/rename lineage, preserved generation edits in versions, safe partial updates, per-file upload failures, similarity availability, live previews, retained diagnostics, cache management, annotation editing and adjacent navigation.
- Final complete local gate passed: lint, typecheck, 125 server + 43 web unit tests, and all 9 real-server Chromium E2Es (60.0 seconds after the directory-picker fix).
- Actual 1,000-image stress: all thumbnails decoded, 70 queries/filters worst 52.1 ms; browser search 93.5–105.6 ms; new file visible after 884 ms; no external requests. Six-format previews pass. Separate synthetic 10,000-record browser virtualization passes (not a 10,000-image ingestion claim).
- Fresh clone/install/start passed with Node 22/pnpm 10 and native prebuilt binaries. The normal default-browser opener launched headless Chromium through isolated Linux desktop associations; the Chinese UI created a library and retained it after reload. Physical macOS/Windows remain user smoke checks.
- Published module checkpoints and documentation already have green CI through c42dedf ([run 37196300041](https://github.com/Sokol13/Cura/actions/runs/37196300041)).

## In progress

- Implementation pushed to main at 2828686. [CI 37197077888](https://github.com/Sokol13/Cura/actions/runs/37197077888) passed install/lint/types/unit checks but failed 2 of 9 browser tests (directory registration and later watcher addition). No v0.1.0 tag has been created.
- Investigating a directory-picker race: a delayed initial home-directory response can replace a manually entered path, accidentally registering/scanning home. Two deferred-response regressions reproduced the overwrite and now pass with 8c5fa58. The complete local gate passes again (168 unit tests, 9 E2Es); the corrected CI run is next. Both affected real-server E2Es also passed unchanged during independent service diagnosis; no speculative watcher fallback was added.
- Artifact downloads are unavailable through the inherited Azure transport; adding readable generated E2E context to CI logs for diagnosis. This does not stop local development.
- Integration worktree: /tmp/cura-runtime, feat-runtime; primary checkout: /workspace/Cura, main. Main will fast-forward to the tested integration commit.
- P1 read-only implementation planning is underway for boards/slots/matrices, brands/CMF, richer previews, process statistics and neutral export. No P1 code is included in v0.1.0.

## Next

1. Finish the full P0 gate and record all nine completion criteria in REPORT-v0.1.0.md; push main and observe green CI.
2. Publish v0.1.0 only after all criteria pass; verify Release, report in chat, immediately begin TASKS.md tasks 7–9.
3. Complete v0.2.0, then P2/task 10 and v0.3.0. Do not stop at an intermediate milestone.

## Resume

Read AGENTS.md, this file and TASKS.md. Mandatory environment setup already succeeded in this session. On a new session run scripts/codex-setup.sh with docs/CODEX_ENV.md exports; .tmp/env.sh is an untracked convenience. Inspect git status/log and active worktrees before editing. Preserve user changes and integrate only completed, tested agent commits. Performance and clean-start evidence is under docs/evidence/v0.1.0/.
