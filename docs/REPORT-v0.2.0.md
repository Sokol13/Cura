# v0.2.0 — Canvas workflows and designer extensions

**Status:** all nine inherited P0 definitions and all P1 definitions passed. The final production source, full local gate, renewed clean startup and [main CI 37204410094](https://github.com/Sokol13/Cura/actions/runs/37204410094) are verified. Final documentation CI 37204693234, tag CI 37205042438 and Release workflow 37205042369 also passed.

**Published release:** [v0.2.0](https://github.com/Sokol13/Cura/releases/tag/v0.2.0), tagged at `5719552` on 2026-10-04.

## Delivered implementation

- Infinite canvases with saved positions/viewport, exact-version asset references, nested groups, connections and text; four slot templates, immutable slot replacement history and independent final owners; stable character-angle and scene-option matrices.
- Brand kits with named HEX/RGB/CMYK colors, registered font files, pinned logo variants and Markdown guidelines; CMF composition; self-contained HTML, paginated PDF, JSON and ASE deliverables.
- Local bounded GLB/OBJ, raw/RLE RGB8 PSD, first-page PDF including CJK mapping, and supported H.264 MP4/MOV previews. Immutable bytes/dimensions, version/revision uploads, all-history cache rebuild and explicit unsupported/retry states.
- Version/prompt timeline, distinct recorded-output selection rates by source/model, guarded manual finalization and usable deterministic mock generation. Cancellation preserves completed partial outputs.
- Whole-library and selected portable ZIP folders with human-readable manifest/CSV, exact retained version bytes/hashes, all organization/history/boards/brands/process metadata, trash and unavailable sources. Selected dependency closure and independent ZIP/CSV/hash validation.

## Acceptance ledger

All inherited definitions are checked individually. The corrected full local command chain passed with NODE_PATH empty: lint, typecheck, 167 server + 95 web unit tests and all 21 real-server Chromium E2Es (2.0 minutes, no retries). PDF decoding runs in native Chromium and actual rebuilt raster images are checked after cache maintenance.

| Inherited v0.1 definition                                          | Current evidence                                                                                                                                                                                                | Status |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1. Clean clone/install/start opens browser and creates library     | Fresh exact production source 179ec28: frozen install in 1.9 seconds, native prebuilts, NODE_PATH empty, normal default-browser opener and Chinese library persistence pass.                                    | Passed |
| 2. 1,000 images, complete thumbnails, watched file under 5 seconds | 10.07-second ingestion, all 1,000 thumbnails decoded; watched file appeared in browser after 874 ms.                                                                                                            | Passed |
| 3. Search/filter under 200 ms and bounded scrolling                | All 70 HTTP samples below 56.4 ms; five input-to-paint samples 93.9–103.4 ms; grid/list frame p95 below 17 ms, maxima 33.4/33.4 ms, no 100-ms long tasks. Separate synthetic 10,000-record UI test also passed. | Passed |
| 4. Automatic SD/Comfy PNG context                                  | Real embedded fixtures display prompts/models and retain exact uint64 seeds; stress checks both formats.                                                                                                        | Passed |
| 5. Replacement preserves history and comparison                    | Original P0 preview/replacement E2Es plus P1 historical slot/brand pin and preview-rebuild flows.                                                                                                               | Passed |
| 6. NFC/NFD names represent one asset                               | Existing Unicode/path/store/API regressions retained and passing; real upgrade fixture also uses Chinese names.                                                                                                 | Passed |
| 7. Offline, no account required                                    | Browser HTTP/WebSocket outside loopback blocked; zero attempted external requests in offline stress/formats/export checks.                                                                                      | Passed |
| 8. Full lint/type/unit/E2E and CI, every P0 feature covered        | Full local gate and [CI 37204410094](https://github.com/Sokol13/Cura/actions/runs/37204410094) passed: 262 units and all 21 real-server browser scenarios. Earlier CI findings are corrected and covered below. | Passed |
| 9. Mac/Windows README and current documentation                    | README/setup, architecture, decisions, feature guides, upgrade verifier, testing and 10-minute smoke checklist updated.                                                                                         | Passed |

| P1 definition                                              | Current evidence                                                                                                                                                                                                  | Status |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Canvas, slot drag/finalize, replacement revision, matrices | Three integrated E2Es use actual drag/drop, React Flow movement/handles/groups, all four presets/custom templates, old-version pins and stable matrices.                                                          | Passed |
| Brand kits and PDF/HTML/JSON/ASE                           | Real UI CRUD/fonts/logos/CMF; independent ASE/JSON byte checks and six PDF pages rendered; downloaded HTML rendered with all networking blocked.                                                                  | Passed |
| Rich previews and creative process                         | Three real-file preview E2Es including Chinese PDF and indented OBJ; two process E2Es cover jobs/timeline/statistics/stale selection.                                                                             | Passed |
| Complete neutral folder/manifest/CSV                       | 205 actual assets, 206 versions, 205 unique payloads and 208 ZIP entries verified by independent Python readers. Selected closure retains two assets/three versions. Native catalog export modal is also covered. | Passed |
| Every P1 feature has E2E; CI green                         | All 21 P0/P1 scenarios passed together locally and in main CI at 44c53a7, including real decoded H.264 video frames.                                                                                              | Passed |
| Upgrade, dependency/assets and documentation               | Real v0.1-to-P1 migration passes 11 preservation/integrity checks and two idempotent reopens. All 150 production package licenses pass; all 190 browser output hashes match the reviewed inventory.               | Passed |

## Fresh verification and review corrections

The clean-clone startup evidence is [recorded here](evidence/v0.2.0/clean-start.json). Its installed graph excludes optional canvas; Node resolution was checked with `NODE_PATH` empty. CI exposed a development-image global canvas dependency in one PDF unit test; the independent decode now runs in real Chromium, with binary/layout/bounds checks still in Node. Watched-preview unit delays now use deterministic timer advances; real watcher timing gates remain unchanged. CI installs Chrome for its H.264 codec support and still verifies decoded video pixels. A pending directory read temporarily disables path edits to prevent a native typing race; controlled unit and browser regressions cover the delayed response.

Independent review reproduced and fixed preview dimensions overwriting source dimensions, delayed brand/CMF mutation target changes, stale timeline finalization, concurrent/stale canvas additions, persistent failures from transient preview errors, missing CJK PDF mapping, whitespace OBJ validation, stale export-job lists, Windows-reserved output names and private operational paths in legacy generation errors. Each correction has a controlled regression; none is hidden by weakening performance thresholds.

The initial parallel foundation stress run exceeded its scroll-frame limit. The unchanged test passed after stopping competing browser work; the same foundation then passed all nine P0 E2Es together in CI. Final release measurements run in an isolated workload window.

## Evidence and limits

[Brand exports](evidence/v0.2.0/brand-exports.json), [neutral export](evidence/v0.2.0/neutral-export.json), [browser bundle inventory](evidence/v0.2.0/browser-bundle-licenses.json), [boards screenshot](screenshots/v0.2-boards.png), [rich previews screenshot](screenshots/v0.2-rich-previews.png). All 190 recorded artifact hashes match the final build (4,232,493 bytes). [Upgrade evidence](evidence/v0.2.0/upgrade.json), [stress evidence](evidence/v0.2.0/p0-stress-evidence.json), [six formats](evidence/v0.2.0/p0-six-format-evidence.json) and [synthetic virtualization](evidence/v0.2.0/synthetic-10000-browser-evidence.json) are retained separately from v0.1 results.

- Physical macOS/Windows, their browser graphics/video capabilities, protected paths and desktop file opening remain user smoke checks. The container verifies Linux/Node 22 with real server and Chromium.
- PSD previews support bounded RGB8 raw/RLE composites. Models require self-contained resources and supported geometry. Video depends on browser codecs; ProRes/HEVC are not promised. PDFs with unavailable encodings/passwords show explicit limitations. No GPL FFmpeg runtime is shipped.
- Brand PDF text is rasterized; HTML/JSON preserve editable text. CMYK is an unprofiled conversion, not an ICC-managed print proof. User font files are supplied by the user; no extra OFL font is redistributed.
- Neutral exports use classic ZIP STORE, capped at 3.5 GB including metadata and 65,532 distinct payload files plus three metadata entries. Oversized or missing/corrupt-byte exports fail visibly; smaller selected subsets remain available.
- Statistics measure distinct recorded outputs and active selected outputs, not unrecorded attempts. The generation provider is explicitly a local mock.
- P2 automation, Supabase/team synchronization and FCPXML are not included in this tag. They follow immediately under [P2-IMPLEMENTATION.md](P2-IMPLEMENTATION.md); this milestone is not a stopping condition.

## User action

Run [SMOKE_TEST.md](SMOKE_TEST.md) on Mac and Windows and report failures with version/system context and diagnostics. No account or credential is required for v0.2.0. Incoming desktop bugs take priority over P2 features.
