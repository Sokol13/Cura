# v0.2.0 — Canvas workflows and designer extensions

**Status:** release candidate; final integrated gate, clean startup and corresponding CI verification are in progress. Do not tag until every acceptance row below passes.

**Release target:** [v0.2.0](https://github.com/Sokol13/Cura/releases/tag/v0.2.0). This link is a target until publication is verified.

## Delivered implementation

- Infinite canvases with saved positions/viewport, exact-version asset references, nested groups, connections and text; four slot templates, immutable slot replacement history and independent final owners; stable character-angle and scene-option matrices.
- Brand kits with named HEX/RGB/CMYK colors, registered font files, pinned logo variants and Markdown guidelines; CMF composition; self-contained HTML, paginated PDF, JSON and ASE deliverables.
- Local bounded GLB/OBJ, raw/RLE RGB8 PSD, first-page PDF including CJK mapping, and supported H.264 MP4/MOV previews. Immutable bytes/dimensions, version/revision uploads, all-history cache rebuild and explicit unsupported/retry states.
- Version/prompt timeline, distinct recorded-output selection rates by source/model, guarded manual finalization and usable deterministic mock generation. Cancellation preserves completed partial outputs.
- Whole-library and selected portable ZIP folders with human-readable manifest/CSV, exact retained version bytes/hashes, all organization/history/boards/brands/process metadata, trash and unavailable sources. Selected dependency closure and independent ZIP/CSV/hash validation.

## Acceptance ledger

| Definition                                           | Evidence                                                                                                                                                                                                                        | Release status                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| All nine v0.1 definitions remain satisfied           | Existing P0 E2Es retained; main foundation CI 37200089559 passed 202 units and nine P0 E2Es. Final integrated 1,000-image/offline/format/virtualization rerun and fresh startup are required below.                             | Final gate pending                               |
| Slots drag/finalize, replace/revise, matrices usable | Three real-server boards E2Es use actual browser drag/drop, ReactFlow movement/handles/groups, all four presets, custom templates, history/old-version pins, stable matrices and 409 recovery.                                  | Module evidence passed; integrated rerun pending |
| Brands create and export PDF/HTML/JSON/ASE           | Real UI CRUD/pins/fonts/CMF and all downloads; independent ASE/JSON byte checks and six PDF pages rendered by PDF.js. Exact HTML bytes rendered with all networking blocked.                                                    | Integrated focused E2E passed                    |
| Rich previews and creative process                   | Three real-file preview E2Es, including Chinese PDF and indented OBJ; process success/failure/cancel/timeline/statistics/stale-selection E2Es.                                                                                  | Integrated focused E2Es passed                   |
| Complete neutral folder/manifest/CSV                 | 205 actual assets, 206 versions and 205 unique payloads; Python zipfile/csv/hashlib independently verifies all bytes and relationships, beyond the public pagination limit. Selected closure retains two assets/three versions. | Integrated focused E2E passed                    |
| Every P1 feature has E2E coverage                    | Boards, brands, process, rich-media, export and catalog selection-export specs cover the public UI against the real server.                                                                                                     | Final combined run pending                       |
| Full quality gate and GitHub Actions green           | lint/typecheck/unit/build and eight integrated focused P1 E2Es passed before final review followups; final exact implementation run/CI must be recorded.                                                                        | Pending                                          |
| Documentation and desktop handoff current            | Board/brand/preview/process-export guides, architecture/decisions, 10-minute Mac/Windows SMOKE_TEST and this report. Actual upgrade evidence is being recorded.                                                                 | Final reconciliation pending                     |

## Review corrections

Independent review reproduced and fixed preview dimensions overwriting source dimensions, delayed brand/CMF mutation target changes, stale timeline finalization, concurrent/stale canvas additions, persistent failures from transient preview errors, missing CJK PDF mapping, whitespace OBJ validation, stale export-job lists, Windows-reserved output names and private operational paths in legacy generation errors. Each correction has a controlled regression; none is hidden by weakening performance thresholds.

The initial parallel foundation stress run exceeded its scroll-frame limit. The unchanged test passed after stopping competing browser work; the same foundation then passed all nine P0 E2Es together in CI. Final release measurements run in an isolated workload window.

## Evidence and limits

[Brand exports](evidence/v0.2.0/brand-exports.json), [neutral export](evidence/v0.2.0/neutral-export.json), [browser bundle inventory](evidence/v0.2.0/browser-bundle-licenses.json), [boards screenshot](screenshots/v0.2-boards.png), [rich previews screenshot](screenshots/v0.2-rich-previews.png). Artifact hashes must match the final build before the release report is finalized.

- Physical macOS/Windows, their browser graphics/video capabilities, protected paths and desktop file opening remain user smoke checks. The container verifies Linux/Node 22 with real server and Chromium.
- PSD previews support bounded RGB8 raw/RLE composites. Models require self-contained resources and supported geometry. Video depends on browser codecs; ProRes/HEVC are not promised. PDFs with unavailable encodings/passwords show explicit limitations. No GPL FFmpeg runtime is shipped.
- Brand PDF text is rasterized; HTML/JSON preserve editable text. CMYK is an unprofiled conversion, not an ICC-managed print proof. User font files are supplied by the user; no extra OFL font is redistributed.
- Neutral exports use classic ZIP STORE, capped at 3.5 GB including metadata and 65,532 distinct payload files plus three metadata entries. Oversized or missing/corrupt-byte exports fail visibly; smaller selected subsets remain available.
- Statistics measure distinct recorded outputs and active selected outputs, not unrecorded attempts. The generation provider is explicitly a local mock.
- P2 automation, Supabase/team synchronization and FCPXML are not included in this tag. They follow immediately under [P2-IMPLEMENTATION.md](P2-IMPLEMENTATION.md); this milestone is not a stopping condition.

## User action

Run [SMOKE_TEST.md](SMOKE_TEST.md) on Mac and Windows and report failures with version/system context and diagnostics. No account or credential is required for v0.2.0. Incoming desktop bugs take priority over P2 features.
