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

- P1 integration is at `/tmp/cura-p1` (`feat-p1`). All boards, brand/CMF, rich-preview, process and neutral-export slices are complete, including independent review corrections.
- Final full local gate at production source `179ec28` passed with NODE_PATH empty: lint, typecheck, 262 units (167 server + 95 web), all 21 real-server E2Es in 2.0 minutes without retries. Actual 1,000-image ingestion took 10.07 seconds; all thumbnails decoded; 70 queries peaked at 56.4 ms, browser searches at 93.9–103.4 ms and watched-file display at 874 ms. Grid/list frame p95 was 16.8 ms; synthetic 10,000-record virtualization also passed.
- Real v0.1-to-P1 migration preserved original identities, fields, timestamps, uint64 seeds, annotations, final selections and file hashes; three-to-six migrations, generation/final-owner backfills, historical pins and two idempotent reopens pass. See UPGRADES.md and evidence/v0.2.0/upgrade.json.
- CI exposed three environment/timing gaps, now corrected: PDF decoding depended on a globally supplied optional canvas; a large store fixture exceeded Vitest's default setup budget; bundled Chromium lacked H.264. Independent PDF decoding runs in the real browser, the 1,000-record setup gets 15 seconds while every query still must stay below 200 ms, and CI explicitly installs Playwright's codec-capable Chrome channel with a startup capability probe and unchanged actual-video-pixel assertions. CI 37203147377 also exposed a native directory-input race: pending directory responses now disable editing, and controlled unit/browser regressions pass.
- The final 190-file browser output audit was refreshed after the directory fix (4,232,493 bytes). Renewed clean clone at exact production source 179ec28 passes frozen install (1.9 seconds), native prebuilts, no optional canvas, normal default-browser opening and Chinese library persistence; private processes are stopped. Main 44c53a7 passed [CI 37204410094](https://github.com/Sokol13/Cura/actions/runs/37204410094), including all 262 units and 21 browser scenarios. Every inherited P0 and P1 acceptance row passes. Final documentation CI and tag/Release verification remain before publication/report.
- P2 design is in P2-IMPLEMENTATION.md. Disposable real local Supabase Auth/refresh/RLS/private Storage and a genuine Apache-2.0 vision model have been verified without user credentials. Small-model malformed structured output is recorded honestly; the planned explicit caption mode retains model text and labels deterministic derivations. Supabase is paused and the model endpoint stopped during release acceptance. P2 implementation starts immediately after v0.2 publication/report.

## Next

1. Push the completed P1 release corrections and evidence to main, observe green CI, and finish the renewed clean-start check.
2. Check every inherited P0 and P1 acceptance row, publish v0.2.0 and report in chat.
3. Immediately implement P2/task 10 through v0.3.0. Keep progress current and prioritize incoming Mac/Windows bugs; do not stop at an intermediate milestone.

## Resume

Read AGENTS.md, this file and TASKS.md. Mandatory environment setup already succeeded in this session. On a new session run scripts/codex-setup.sh with docs/CODEX_ENV.md exports; .tmp/env.sh is an untracked convenience. Inspect git status/log and active worktrees before editing. Preserve user changes and integrate only completed, tested agent commits. Performance and clean-start evidence is under docs/evidence/v0.1.0/.
