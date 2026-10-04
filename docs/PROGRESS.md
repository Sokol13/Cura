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

## In progress

- Final report/evidence documentation CI, followed by v0.1.0 tag and Release verification. No tag has been created yet. All nine P0 definitions have evidence; physical Mac/Windows remain the explicitly delegated smoke-test boundary.
- P1 is already underway on isolated branches; it is excluded from the P0 tag. Coordinator integration: /tmp/cura-p1 (feat-p1). Module branches: /tmp/cura-boards (boards server), /tmp/cura-board-web (boards UI), /tmp/cura-brands (brands/CMF), /tmp/cura-rich-media (rich previews), /tmp/cura-process (process/export). Shared contracts and initial persistence/helpers are being integrated; these are not yet a completed P1 release.
- P1 scope/ownership/decisions are specified in docs/P1-IMPLEMENTATION.md on feat-p1. Root owns routing/navigation/journal/dependencies and main pushes. Agents must commit only their assigned module files; temporary integration wiring stays uncommitted in their worktrees.

## Next

1. Verify the final documentation commit CI, then publish and verify v0.1.0 tag/Release.
2. Report the verified v0.1.0 release in chat and continue integrating TASKS.md tasks 7–9 without stopping.
3. Complete v0.2.0, then P2/task 10 and v0.3.0. Do not stop at an intermediate milestone.

## Resume

Read AGENTS.md, this file and TASKS.md. Mandatory environment setup already succeeded in this session. On a new session run scripts/codex-setup.sh with docs/CODEX_ENV.md exports; .tmp/env.sh is an untracked convenience. Inspect git status/log and active worktrees before editing. Preserve user changes and integrate only completed, tested agent commits. Performance and clean-start evidence is under docs/evidence/v0.1.0/.
