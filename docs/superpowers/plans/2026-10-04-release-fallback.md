# CI-gated Release Fallback Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. The user authorized milestone publication after verified completion and green CI; the coordinator alone activates the request. Do not create `.github/release-request.json` in this task.

**Goal:** Allow the repository's Actions token to publish v0.3.0 after its exact main commit passes CI when interactive GitHub credentials cannot publish tags/releases.

**Architecture:** A `workflow_run` job checks out the successful push-to-main CI SHA. A dependency-free Node script validates a committed, explicit request and reads the tested files through Git before inspecting remote main, tags and releases. All child commands use argument arrays; the job creates an annotated tag without force and publishes generated notes itself because Actions-token tag pushes do not trigger the existing release workflow.

**Tech Stack:** GitHub Actions, Node 22 built-ins, Git, GitHub CLI, node:test.

**Spec:** AGENTS.md sections 2–4; coordinator's authorized release-fallback task; docs/RELEASE-FALLBACK.md records the exact activation contract.

## Global constraints

- No active request, tag, remote write or release during development/testing.
- `contents: write` belongs only to the guarded release job.
- Accept only completed successful CI triggered by a main push in this repository, with the exact tested checkout.
- Package versions, explicit report readiness and server/shared/web Git tree hashes must match the request; current remote main must equal the tested SHA before each publication write.
- Existing tags are never forced or moved. A mismatched tag fails closed; a matching published release is a no-op.

## Review focus

1. Fork/PR/failure/stale CI events must not reach publication.
2. Absent requests skip; malformed or incomplete requests fail before writes.
3. Changed production files, versions or unfinished reports must invalidate readiness.
4. Partial tag/release publication must recover safely without moving a tag.
5. API/authentication/network errors must stop publication without exposing tokens.

## Task 1: Gate, workflow and documentation

**Files:** `.github/workflows/release-fallback.yml`, `scripts/release-from-ci.mjs`, `scripts/release-from-ci.test.mjs`, `package.json`, `docs/RELEASE-FALLBACK.md`, `docs/DECISIONS.md`, `docs/PROGRESS.md`.

**Interfaces:** `publishRequestedRelease({ eventName, event, repository, run })` returns an inactive/already-published/published result. `run(command, args)` is an injectable command seam; production uses `execFileSync` with piped output and sanitized errors. `validateReleaseRequest(value)` validates the fixed v0.3.0 request described in the guide.

- [x] Write failing node:test cases covering valid/invalid requests, each CI guard, absent requests, mismatched checkout/main/tree/version/report, idempotence, failed publication and sanitization.
- [x] Run `node --test scripts/release-from-ci.test.mjs`; confirm RED before implementation.
- [x] Implement the script and strict workflow, and add tests to the ordinary `pnpm test` command.
- [x] Document the inactive sample, the existing authorization, activation/removal steps and limits.
- [x] Run focused tests, formatting/lint and the normal unit suite; obtain independent review and fix material findings.
- [x] Commit only this scope and return the tested commit for coordinator integration. Record evidence in PROGRESS.md; activation remains the coordinator's responsibility.

**Verification:** Initial tests failed because implementation was absent; all 12 gate tests then passed. Full lint and typecheck passed; the normal suite passed 264 server, 136 web and 16 Node script tests, with 17 live-cloud tests skipped without configuration. Independent read-only review found no material defects. Public GitHub run metadata for CI runs 37207974648 and 37205594707 confirmed the exact workflow path used by both guards. No publication was attempted.
