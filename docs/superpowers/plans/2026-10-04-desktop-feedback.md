# Desktop feedback implementation plan

> **For agentic workers:** Execute this plan task by task with a durable PROGRESS.md ledger. Independent within-task implementation/review may use subagents; release order is fixed by the user.

**Goal:** Fix the nine desktop blockers in v0.3.1, then deliver six workflow improvements in v0.4.0.

**Architecture:** Retain immutable snapshots, portable shared contracts and worker-based file processing. Extend existing catalog/media/board/export boundaries; use additive versioned migrations for persistent summaries, migration state or history metadata. Keep product features fully local and treat cloud as optional.

**Tech Stack:** TypeScript, Node/Fastify/SQLite/Sharp workers, React/Vite/i18next/React Flow, Vitest and real-server Playwright.

**Spec:** [DESKTOP-FEEDBACK.md](../../DESKTOP-FEEDBACK.md), plus AGENTS.md's unchanged quality/data/portability rules.

## Global constraints

- Implement/push items 1–9 in order, verify/tag v0.3.1, then implement/push items 10–15 and verify/tag v0.4.0.
- No user questions. Log assumptions and interface rulings in DECISIONS.md. User-reported desktop results are not container measurements.
- PSD target: each representative 3866×6871, 8192×8192 and 13391×7032 fixture below 10 seconds and 500,000,000 bytes absolute peak server-process RSS including its worker. The middle size is a documented proxy, not the user's unknown third size. No full-resolution layer/image buffer.
- No source mutation for registration/trash; upload migration moves only Cura-owned Inbox sources. Preserve immutable hashes/version records.
- Node engines become `>=22 <25` at item 8; full Node 22/24 CI is mandatory afterward.
- Each item: targeted failing regression → implementation → focused checks → lint/types/full units/E2E → progress/commit/push/CI. Performance gates run without competing test workloads.

## Review focus

- Multi-source deduplication: removing one root must not accidentally discard assets still supplied elsewhere (task 2).
- Corrupt/huge PSD offsets, RLE runs, ZIP output and legacy BGR channels must remain bounded (task 1).
- Empty/denied scans and truncated logs must remain explainable without leaking credentials (tasks 3–4).
- Inbox collisions, partial migrations and locked Windows sources must preserve bytes/identity (task 11).
- Stale canvas/history/export selections must preserve exact historical pins and avoid displaying a different asset (tasks 12–14).

## Shared interfaces and dependency rulings

- Task 3 introduces persisted `ScanSummary` shared/API data, consumed by task 4 diagnostics; keep totals and bounded detail counts explicit.
- Task 2 introduces source-availability filtering and root-removal policy used by later diagnostics/onboarding. Trashing is logical, not a filesystem move.
- Task 11 changes source locators, not immutable AssetVersion metadata. Its migration follows any scan/diagnostic migration added earlier.
- Tasks 12–13 use the same slot assignment/history transaction and actor contract. Task 14 reuses export snapshot dependency closure rather than approximating it in the browser.
- Later-task research may happen early, but implementation/integration remains numbered and v0.4 starts only after the v0.3.1 release.

### Task 1: Bounded PSD previews

**Files:** Create server/media/psd\*.ts and tests; modify server/media/image.ts, service.ts; extend e2e/rich-media.spec.ts and PREVIEWS.md.
**Interfaces:** readPsdPreview(path) returns bounded PNG plus original width/height and selected source, or null for existing fallback. Rebuild/retry must repair previously unsupported PSDs.

- [x] Write and observe a failing regression covering resource 1036 priority, legacy1033 BGR/raw padding, merged raw/RLE/ZIP, corruption limits, retained hash/dimensions, old-cache recovery; large separate-process RSS/time and actual browser thumbnail.
- [x] Implement the bounded change and run focused Vitest/Playwright checks; expected result: every stated behavior passes.
- [x] Run the complete required checks, record measured evidence/limits in PROGRESS.md, commit and push main; verify its CI before considering this item delivered.

### Task 2: Root removal and unavailable-source filter

**Files:** shared/catalog.ts, server/catalog-store.ts, catalog-search.ts, catalog-routes.ts, media/service.ts; web/catalog/SettingsDialog.tsx and Filters.tsx.
**Interfaces:** Explicit root-removal mode defaults to trash; store applies it atomically after watcher drain. Availability query is derived from active sources, not snapshot existence.

- [x] Write and observe a failing regression covering two confirmation modes, trash/restore/history, multiple source aliases, re-registration identity, concurrent scan/removal, Chinese/English filter UI.
- [x] Implement the bounded change and run focused Vitest/Playwright checks; expected result: every stated behavior passes.
- [x] Run the complete required checks, record measured evidence/limits in PROGRESS.md, commit and push main; verify its CI before considering this item delivered.

### Task 3: Persistent recursive scan summaries

**Files:** shared/catalog.ts; server/media/worker.ts, service.ts; additive SQL/schema; catalog routes/store; registered-root UI.
**Interfaces:** ScanSummary records completion state/timestamps, supported/skipped/error totals, bounded extension histogram and errors; last summary survives restart.

- [x] Write and observe a failing regression covering nested images, empty folder, unsupported extensions, denied subdirectory and partial success, terminal 0/0 state, restart and details UI.
- [x] Implement the bounded change and run focused Vitest/Playwright checks; expected result: every stated behavior passes.
- [x] Run the complete required checks, record measured evidence/limits in PROGRESS.md, commit and push main; verify its CI before considering this item delivered.

### Task 4: Actionable diagnostic bundles

**Files:** server/app.ts, diagnostics route/store, media/service.ts and worker.ts; shared diagnostics schemas and tests.
**Interfaces:** Bundle exposes per-root last ScanSummary, bounded recent 200 warning/error records, queue counters and SQLite integrity/foreign-key results; redact secrets.

- [x] Write and observe a failing regression covering real scan denial, metadata warning and thumbnail failure, log rotation/order/200 cap, idle/active queue state, integrity response and ZIP inspection.
- [x] Implement the bounded change and run focused Vitest/Playwright checks; expected result: every stated behavior passes.
- [x] Run the complete required checks, record measured evidence/limits in PROGRESS.md, commit and push main; verify its CI before considering this item delivered.

### Task 5: Localized preset slots

**Files:** server/boards/presets.ts; web/boards/i18n.ts, SlotCard.tsx, TemplateManager.tsx and forms.
**Interfaces:** Stable built-in identities map default labels/descriptions through i18n; custom/renamed values remain exact.

- [x] Write and observe a failing regression covering every built-in slot label/description in zh-CN and en, existing generated template compatibility, custom rename preserved.
- [x] Implement the bounded change and run focused Vitest/Playwright checks; expected result: every stated behavior passes.
- [x] Run the complete required checks, record measured evidence/limits in PROGRESS.md, commit and push main; verify its CI before considering this item delivered.

### Task 6: Platform shortcut hints

**Files:** Create shared web shortcut-format utility; replace hardcoded hints in App/catalog/board/dialog UI.
**Interfaces:** One formatter maps primary modifier using browser platform; keyboard handling still accepts metaKey and ctrlKey.

- [x] Observe the incorrect Windows/Linux baseline, then verify rendered Mac/Windows/Linux hints and keyboard focus/editable-field boundaries with a real-browser platform simulation. Keep this small display change free of implementation-mirroring unit tests.
- [x] Implement the bounded change and run focused Vitest/Playwright checks; expected result: every stated behavior passes.
- [x] Run the complete required checks, record measured evidence/limits in PROGRESS.md, commit and push main; verify its CI before considering this item delivered.

### Task 7: Full-width preview messages

**Files:** web/catalog/Inspector.tsx, AssetPreview.tsx and preview/media styles.
**Interfaces:** Generic preview icon and status text stack vertically; text wraps across panel width at narrow sizes.

- [x] Reproduce the narrow message in a real browser and verify the corrected geometry with a before/after probe covering long Chinese and English preview errors at narrow inspector width; no horizontal clipping and icon above message.
- [x] Implement the bounded change and run focused Vitest/Playwright checks; expected result: every stated behavior passes.
- [x] Run the complete required checks, record measured evidence/limits in PROGRESS.md, commit and push main; verify its CI before considering this item delivered.

### Task 8: Node 24 support and matrix

**Files:** root/package.json, setup/prebuilt scripts, docs/SETUP.md, CODEX_ENV.md, ci.yml, cloud-check.yml, release.yml and affected dependencies only if needed.
**Interfaces:** Node 22/24 both install native prebuilts, build/start and pass lint/types/units/browser/cloud; engines >=22 <25.

- [x] Write and observe a failing regression covering fresh Node24 install/start and full suite; actual CI matrix includes core and configured cloud jobs on both versions.
- [x] Implement the bounded change and run focused Vitest/Playwright checks; expected result: every stated behavior passes.
- [x] Run the complete required checks, record measured evidence/limits in PROGRESS.md, commit and push main; verify its CI before considering this item delivered.

### Task 9: UTF-8 first PNG tEXt

**Files:** server/media/metadata.ts and metadata fixtures/tests.
**Interfaces:** Decode tEXt value using fatal UTF-8; catch decoding errors only to decode Latin-1. Preserve existing iTXt/zTXt behavior.

- [x] Write and observe a failing regression covering valid Chinese UTF-8 prompt/model, Latin-1 accents, malformed UTF-8 fallback, keyword separation and exact uint64 metadata.
- [x] Implement the bounded change and run focused Vitest/Playwright checks; expected result: every stated behavior passes.
- [x] Run the complete required checks, record measured evidence/limits in PROGRESS.md, commit and push main; verify its CI before considering this item delivered.

### v0.3.1 release gate — required before task 10

- [x] All nine rows delivered on main; fresh install/start and inherited acceptance verified on Node22/24; actual CI green.
- [x] Update four package versions, CHANGELOG, SMOKE_TEST and REPORT-v0.3.1.md; review every completion row and physical/file limits.
- [x] Publish annotated v0.3.1 and verify tag/release CI and GitHub Release; report in chat and immediately continue task10.

### Task 10: Folder-first empty state

**Files:** web/catalog/AssetGrid.tsx, App.tsx, catalog i18n/styles and browser onboarding test.
**Interfaces:** Primary registration action opens the server directory browser; secondary file import retains current behavior.

- [x] Write and observe a failing regression covering empty create-library flow, clear original-files explanation, both keyboard-accessible actions and actual folder registration.
- [x] Implement the bounded change and run focused Vitest/Playwright checks; expected result: every stated behavior passes.
- [x] Run the complete required checks, record measured evidence/limits in PROGRESS.md, commit and push main; verify its CI before considering this item delivered.

### Task 11: Readable Inbox and migration

**Files:** server/media/service.ts, catalog-store.ts, paths helpers; additive migration/journal and upgrade tests.
**Interfaces:** Managed uploads use local calendar date and collision-only short suffix. Migration updates source locators idempotently while version rows/hashes remain unchanged.

- [ ] Write and observe a failing regression covering same-name concurrent upload, Chinese/NFD names, old UUID upgrade, name collision, crash/retry, locked-file recovery and exact version-row/hash comparison.
- [ ] Implement the bounded change and run focused Vitest/Playwright checks; expected result: every stated behavior passes.
- [ ] Run the complete required checks, record measured evidence/limits in PROGRESS.md, commit and push main; verify its CI before considering this item delivered.

### Task 12: Canvas-to-slot drops

**Files:** web/boards/BoardCanvas.tsx, SlotCard.tsx, useBoardDocument.ts and real browser board tests.
**Interfaces:** Free-node drop resolves exact asset/version and invokes existing slot assignment; canvas coordinates alone do not assign.

- [ ] Write and observe a failing regression covering actual canvas node drag into empty/filled slot, finalized pin/history, unchanged drag outside slots and stale selection guard.
- [ ] Implement the bounded change and run focused Vitest/Playwright checks; expected result: every stated behavior passes.
- [ ] Run the complete required checks, record measured evidence/limits in PROGRESS.md, commit and push main; verify its CI before considering this item delivered.

### Task 13: Slot history comparison

**Files:** shared/boards contracts; server/boards/store.ts/history migration; web/boards/SlotHistory.tsx and comparison component.
**Interfaces:** Select two revision identities, display immutable version previews and originating asset/actor/time. Legacy unknown actor is explicit.

- [ ] Write and observe a failing regression covering two different assets plus historical versions, exact source bytes after replacement, actor/time persistence/cloud/export, deleted-source history and accessible side-by-side UI.
- [ ] Implement the bounded change and run focused Vitest/Playwright checks; expected result: every stated behavior passes.
- [ ] Run the complete required checks, record measured evidence/limits in PROGRESS.md, commit and push main; verify its CI before considering this item delivered.

### Task 14: Explain export dependencies before download

**Files:** server/exports/snapshot.ts, service/routes; shared/export contracts; web/catalog/ExportDialog.tsx.
**Interfaces:** Preview endpoint uses actual closure computation and returns selected/dependency IDs/counts with reasons; creation remains authoritative if source changes.

- [ ] Write and observe a failing regression covering 2 selected +2 board dependencies, version-file versus asset-count distinction, other dependency reasons, stale/cancelled preview, ZIP IDs match preview.
- [ ] Implement the bounded change and run focused Vitest/Playwright checks; expected result: every stated behavior passes.
- [ ] Run the complete required checks, record measured evidence/limits in PROGRESS.md, commit and push main; verify its CI before considering this item delivered.

### Task 15: Canvas idle performance and screenshot reliability

**Files:** web/boards/BoardCanvas.tsx/useBoardDocument.ts and relevant event effects only when reproduced; e2e board performance harness; TESTING.md.
**Interfaces:** Record Performance API frame distribution, long tasks, redraw/request frequency and repeated CDP screenshot success during idle. Correct demonstrated unbounded invalidation.

- [ ] Write and observe a failing regression covering idle populated canvas and slot/matrix cases, no continuous rerender/poll loop, repeated screenshots without renderer timeout, Linux evidence separated from Windows verification.
- [ ] Implement the bounded change and run focused Vitest/Playwright checks; expected result: every stated behavior passes.
- [ ] Run the complete required checks, record measured evidence/limits in PROGRESS.md, commit and push main; verify its CI before considering this item delivered.

### v0.4.0 release gate

- [ ] All 15 numbered rows verified, including upgrade preservation and explicit device-only limits in REPORT-v0.4.0.md.
- [ ] Fresh whole-branch review; resolve material findings, full Node22/24 local/CI gates, clean install/start and final migration/exports acceptance.
- [ ] Update versions/CHANGELOG/SMOKE_TEST/PROGRESS, publish annotated v0.4.0 and verify Release. Stop owned processes and finish with clean main and green CI.
