# Cura Delivery Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans with isolated parallel module worktrees. The user explicitly selected autonomous execution and main pushes; do not request further design or plan approval. Each task requires tests, integration and current PROGRESS.md before a main push.

**Goal:** Deliver the three AGENTS.md milestones in order without stopping at intermediate reports.

**Architecture:** A local Fastify server owns SQLite and all filesystem operations. Worker threads process media and React consumes shared Zod contracts over HTTP/WebSocket. Immutable content snapshots preserve versions and portable exports.

**Tech Stack:** Node 22, pnpm 10.34.6, TypeScript strict, Fastify, better-sqlite3/Drizzle, Sharp, chokidar, exifr, Zod, React/Vite/Tailwind, Zustand, TanStack Virtual, React Flow and i18next.

**Spec:** `AGENTS.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`.

## Global constraints

- Runtime dependencies only MIT / Apache-2.0 / BSD / ISC; no copied GPL/AGPL implementation.
- Local-only 127.0.0.1, validated Host/Origin, safe registered-root/data-directory file access.
- No `any`; English code/comments/docs, default zh-CN and complete English UI.
- Path operations via node:path; NFC normalized database paths, actual filesystem spelling retained separately.
- Originals untouched; all caches/database/logs under OS user directories; hashing/scanning/thumbnails in workers.
- A task is complete only after `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` passes, main is pushed and GitHub CI is observed green.
- Bugs from user smoke tests preempt feature development. Never tag a partial milestone.

## Review focus

1. External overwrite during scan must preserve the old version and never serve partially written content (Tasks 2–4).
2. Symlink escapes, traversal, executable SVG and malicious PNG chunks must not expose arbitrary files or script execution (Tasks 2–4).
3. Restart, watcher duplication and NFC/NFD filenames must not create duplicate assets or lose references (Tasks 2–4).
4. Large catalogs and many file changes must keep API latency below 200 ms and UI DOM bounded (Tasks 4–6).
5. Cross-library IDs, invalid folder cycles and partial exports must not corrupt or leak catalog structure (Tasks 3, 7–9).

## Task 1: Phase-1 product and architecture documents

**Files:** docs/RESEARCH.md, PRD.md, ARCHITECTURE.md, TASKS.md, DECISIONS.md, PROGRESS.md.
**Interfaces:** Consumes AGENTS.md; produces fixed endpoint and module boundaries in ARCHITECTURE.md.

- [x] Inspect scaffold and read governing requirements.
- [x] Research upstream architecture/licenses/metadata; write PRD and architecture; self-check every P0/P1/P2 feature has an owner below.
- [x] Run full quality command. Expected: lint/types/tests/real-server Chromium E2E all pass.
- [x] Commit documentation, push main, verify Actions (`56433f2`, run 37194418005 green).

## Task 2: Media metadata and processing primitives (parallel A)

**Files:** packages/server/src/media/{metadata,image,path-utils}.ts and corresponding test files; dependencies installed centrally.
**Interfaces:** `parsePngMetadata(input: Buffer): GenerationMetadata`; `GenerationMetadata = { prompt: string; negativePrompt: string; model: string; seed: string; source: string; params: Record<string, unknown> }`. `processFile(input: { filePath: string; dataDir: string; cacheDir: string }): Promise<ProcessedFile>`; output includes hash, size, type, width, height, colors, phash, exif, generation, snapshotPath, thumbnailPath. Paths in processing result are absolute private server paths. `normalizeRelativePath(value: string): string` and `resolveContained(root: string, relative: string): Promise<string>`.

- [x] Write failing tests for SD parameters, ComfyUI graph references, malformed/oversized PNG chunks, palette/dimensions/hash, immutable snapshot, NFC dedup path and symlink escape.
- [x] Run tests and confirm missing behavior; implement bounded PNG tEXt/zTXt/iTXt parsing, Sharp/exifr processing and path containment.
- [x] Test at least one generated PNG end to end through processFile, unsupported format fallback and corrupted image behavior. Expected: deterministic metadata and safe retained bytes.
- [x] Integrate tests with Task 3/4; full gate; commit/push.

## Task 3: Catalog contracts and persistence

**Files:** packages/shared/src/catalog.ts; packages/server/src/catalog-store.ts, catalog-mappers.ts if needed; drizzle/0001_catalog.sql and journal; test/catalog-store.test.ts.
**Interfaces:** Shared schemas/types follow ARCHITECTURE.md. `CatalogStore` constructor consumes `AppDatabase`; methods expose libraries/roots/assets/versions/folders/tags/collections/annotations, query/filter and batch operations. `ingest(input)` consumes Task-2 ProcessedFile plus libraryId, rootId, relativePath and actualRelativePath; returns `{ asset, changed }`. All API-visible results parse shared schemas.

- [x] Write failing transaction tests for create/reopen, content/path dedup, NFC/NFD aliases, replacement ordinal/old snapshot, FTS tags/notes/prompts, all combined filters, cross-library rejection, trash/restore, folder cycles, short Chinese substring search and persisted settings.
- [x] Implement migration and prepared store transactions, FTS5 index maintenance and indexed library queries; retain all domain timestamps.
- [x] Run real SQLite tests, including 1000-row query latency. Expected: correct persisted results and <200 ms measured queries.
- [x] Full gate; commit/push. Task 2 may run in parallel; integration waits for both contracts.

## Task 4: Local library lifecycle, ingestion and API

**Files:** packages/server/src/media/{worker,service}.ts, catalog-routes.ts, app.ts, index.ts; server integration tests; scripts/start.mjs.
**Interfaces:** Routes and events exactly as ARCHITECTURE.md. `MediaService` consumes CatalogStore/UserPaths and broadcasts shared events. Worker only performs heavy filesystem/media work; store mutations remain short coordinator transactions.

- [x] Write failing real-app tests for library/root creation, bounded raw uploads, directory picker, worker ingestion, restart/rescan, live additions, replacement, safe stream endpoints and diagnostics ZIP.
- [x] Implement worker queue, chokidar watcher, atomic snapshots, error handling, API schema validation and graceful shutdown. Start script builds missing/stale production output for clean install/start.
- [x] Run real server tests; assert watcher adds within 5 seconds, old bytes survive replacement, traversal/Origin blocked and originals unchanged. Add simulated Windows file-in-use / >260-character paths and macOS EPERM actionable guidance tests; distinguish simulation from real-machine smoke evidence.
- [x] Full gate; commit/push.

## Task 5: P0 browser asset library and organization (parallel B after contracts)

**Files:** packages/web/src/catalog/\*, App.tsx, styles.css, i18n.ts, web tests; e2e/catalog.spec.ts.
**Interfaces:** Uses shared schemas and HTTP endpoints only. Persist library, theme, language, view/column state through Zustand. Virtualized grid/list reads paginated assets and displays thumbnails by version ID.

- [x] Write failing browser tests for create/open, directory registration, file picker/drop upload, selection, folder tree, tag groups/colors, rating/notes/batch operations, trash/restore and smart collections.
- [x] Implement three-column dark/orange shell, empty/loading/error states, complete bilingual strings and light theme.
- [x] Implement combined search/filters, palette color and similar-image queries; inspector edits generation metadata. Keyboard Cmd/Ctrl+F, arrows, Delete and Space must ignore editable fields.
- [x] Real-server E2E and web unit tests; full gate; screenshots; commit/push.

## Task 6: P0 detail, versions, diagnostics and milestone acceptance

**Files:** web preview/version/settings components; e2e/p0.spec.ts, e2e/stress.spec.ts; scripts/generate-fixtures.mjs; README, TESTING, SMOKE_TEST, REPORT-v0.1.0, CHANGELOG.
**Interfaces:** Uses persisted AssetVersion/Annotation contracts; normalized annotation coordinates; compare immutable versions.

- [x] Write failing E2E for preview/zoom, version-specific annotations, replacement/history/side-by-side, cache rebuild, diagnostic ZIP, offline state and complete P0 lifecycle with all non-loopback requests blocked.
- [x] Implement detail/settings; generate a deterministic 1000-image fixture with SD/Comfy PNG metadata.
- [x] Run focused stress E2E: all thumbnails, <=5-second watcher, every search/filter <200 ms, bounded grid DOM and measured scroll responsiveness. Browser input-to-paint, six-format previews and separate synthetic 10,000-record virtualization also passed.
- [x] Independent review of full P0 diff; reproduce and fix material bugs with tests. Record true platform limits.
- [x] Clean clone/install/start automatically opens the configured Linux browser; create/reload a library through the Chinese UI.
- [x] Verify all nine AGENTS.md v0.1.0 definitions against the final integrated commit.
- [x] Full local gate, push main and verify CI, update report/README/smoke/changelog/version, tag only when all gates hold; verify release workflow. Report in chat, continue Task 7.

## P1 foundation checkpoint

- [x] Integrate ordered process/boards/brand migrations, shared contracts, exact-version final ownership, stable generation identity, brand persistence, board APIs/live invalidation, local mock jobs and bounded preview uploads.
- [x] Independent foundation/board review; fix source-dimension overwrite with actual PSD regression; drain generation before media/database on shutdown.
- [x] Integrated lint/typecheck and 202 unit tests; all nine P0 E2Es passed across full functional run plus isolated unchanged stress rerun. Main checkpoint fd850d6 passed CI 37200089559 including all nine P0 E2Es together. Full P1 browser slices/export remain below.

## Task 7: P1 boards, slots and matrices

**Files:** shared board contracts; server board store/routes/migration; web boards; tests and e2e/boards.spec.ts.
**Interfaces:** Persisted Board/BoardItem/SlotTemplate/Slot reference asset IDs. Slot assignment records finalized version; replacing assignment increments slot revision without overwriting asset history.

- [ ] Write failing persistence and E2E tests for infinite canvas pan/zoom, positions/groups/edges/text, templates, drag/drop finalization, replacement revision and character-angle/scene-option matrices.
- [ ] Implement React Flow view and local APIs with per-library validation, persist reload state and reusable templates.
- [ ] Full gate, docs/progress, commit/push/CI.

## Task 8: P1 brands, CMF, rich previews and creative process (parallel C/D)

**Files:** shared brand/process contracts; server brands/process modules; web brands/cmf/preview adapters; tests/e2e.
**Interfaces:** Brand/Color/Font/Logo and CMFBoard reference same catalog; colors include named HEX/RGB/CMYK. Portable brand outputs HTML/PDF and JSON/ASE. Preview adapters return local image blobs, never execute document scripts. Process timeline uses AssetVersion generation metadata and finalized flag; provider interface includes deterministic mock.

- [ ] Write failing tests for brand CRUD/font registration/logo guidelines and every export, CMF composition, GLB/OBJ/PSD/PDF/video supported previews, timeline/model-source hit rates.
- [ ] Audit dependency licenses and install permitted readers/renderers; implement browser-first 3D/video capture and bounded document parsing. Unsupported codecs yield explicit generic preview and cannot silently pass a capability gate.
- [ ] Full gate with E2E for each P1 feature, docs/progress, commit/push/CI.

## Task 9: P1 neutral export and v0.2.0 gate

**Files:** server exports module; shared export schema; web export controls; e2e/export.spec.ts; milestone documents.
**Interfaces:** Export folder contains original files, all versions, readable manifest.json and CSV. Manifest includes library/roots, metadata, folders/tags, annotations, boards/slots, brands/CMF and timestamps. Source paths are informative; portable paths are relative and cannot escape export root.

- [ ] Write failing tests exporting selected assets and entire populated library, inspecting bytes and validating all metadata/CSV quoting/filename collisions.
- [ ] Implement streaming ZIP download that expands to the required portable folder; make export self-contained and offline-readable.
- [ ] Independent review; v0.1 regression + all P1 E2E; every v0.2 criterion checked. Full gate, main push/CI, docs/report/smoke/changelog, tag/release verification, chat report; continue P2.

## Task 10: P2 complete capabilities and final gate

**Files:** modules agents, sync adapters, supabase/migrations/\*.sql, fcpxml; respective contracts/tests/UI and REPORT-v0.3.0.
**Interfaces:** Vision provider has a usable configured implementation plus test provider; local automation is previewable/reversible. Supabase adapter uses env configuration and RLS; missing credentials never disable local catalog. FCPXML is standards-based escaped XML using exported media paths.

- [ ] Plan concrete P2 module tests before implementation: auto tags/naming, nonfinal archive rules, script entity extraction, setting documents, optional login/local-first incremental conflict logs/team RLS, FCPXML validation.
- [ ] Implement complete slices; test each implemented capability; document any omitted capability with concrete reason, especially unverified live cloud credentials.
- [ ] Independent review, all earlier milestone gates, full suite/CI and release documentation/tag. Stop only when all milestones attained or a section-1 blocker is proven and recorded after three different approaches.

## Task ledger

Tasks 1–5: delivered to main with full local gates and observed green CI. Task 6: all nine P0 definitions are verified; 170 unit tests and 9 real-server E2Es pass locally and in CI 37198719712 at 8cec733. Published v0.1.0 at c564361; documentation CI 37198939724, tag CI 37199147410 and Release workflow 37199147287 all passed. Reported the release in chat and continued P1. The nine-item acceptance ledger is in REPORT-v0.1.0.md. Tasks 7–10 follow immediately; v0.1.0 is not a stopping condition. Per-task evidence and rulings remain in PROGRESS.md and DECISIONS.md.
