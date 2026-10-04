# Testing

## Commands and isolation

Use Node 22 and pnpm 10.34.6 from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium chrome
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
```

On Linux, browser system dependencies may require `pnpm exec playwright install --with-deps chromium chrome`. Windows may use `pnpm.cmd`. `pnpm lint` includes the production/transitive license allowlist, ESLint and Prettier; typecheck builds the shared contracts first; Vitest exercises server and web modules; E2E builds production packages before testing.

Playwright starts a real compiled server at `http://127.0.0.1:4318`, with temporary database/cache/log directories and no browser auto-open. It does not reuse an existing server. `CURA_E2E_PORT` overrides the port for isolated parallel development; final performance acceptance runs without competing browser suites. The harness stops the child and removes its temporary directories. Keep the selected port free. `playwright-report/` and `test-results/` contain results/failure traces; milestone screenshots live under `docs/screenshots/`. The P0 UI screenshot is `v0.1.0.png`; `startup.png` records the current startup flow, and `phase-0.png` preserves the historical scaffold.

## P0 coverage and evidence

The following records module checks and the completed integrated release gate. Exact test counts, commit IDs, CI links, and final milestone results belong in [PROGRESS.md](PROGRESS.md) and the version report so this methodology does not acquire stale totals.

| Area               | Verification and expected assertions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation         | Passing baseline checks cover health/static hosting, Host/Origin rejection, CLI settings, real SQLite migrations/timestamps/reopen, and React translation changes. The original real-server Chromium smoke path and clean install/start were verified in phase 0; see [REPORT-v0.0.1.md](REPORT-v0.0.1.md).                                                                                                                                                                                                                                  |
| Media              | Integrated unit checks cover exact SD/Comfy seed parsing, text chunks and CRCs, corrupt/oversized metadata, graph ambiguity, immutable byte snapshots, palette/dimensions/pHash, EXIF, GIF/SVG behavior, NFC identity with actual NFD locators, and containment/symlink rejection. Invalid inputs must not produce fabricated metadata or mismatched snapshot/preview bytes.                                                                                                                                                                 |
| Persistence/search | Real SQLite checks cover libraries/roots, duplicate aliases and divergence, version retention, manual replacement/rescan, missing-source recovery, tags/groups/folders, annotation ownership/editing, smart collections, partial settings updates and atomic cross-library rejection. Manual generation corrections remain in archived versions. The 1,000-record store benchmark is separate from HTTP/browser performance acceptance.                                                                                                      |
| Runtime API        | API integration tests use real files, SQLite, worker processing and watchers through Fastify injection. They cover registration/upload, retained old bytes, unchanged originals, safe streams, cache usage/clear/rebuild, organization, diagnostics and invalid inputs. Worker regressions cover in-flight changes, bounded queue overflow, rescan races, permission recovery and shutdown-before-database-close. These are not Chromium E2Es.                                                                                               |
| Catalog/preview UI | Component tests cover local controls and API edge cases. Real-server `catalog.spec.ts` and `preview.spec.ts` separately exercise create/register/upload/drop, organization/filter/restore/settings, metadata, annotation edits, version replacement/compare, adjacent navigation and watched-file changes while preview stays open. Unsupported files remain manageable and active SVG originals download safely.                                                                                                                            |
| Formats/scale      | `formats.spec.ts` covers all six P0 image formats using real encoded files and the server. `stress.spec.ts` covers real 1,000-image ingestion/search/watch/offline operation. `virtualization.spec.ts` separately exercises 10,000 synthetic browser records; its mocked pagination must never be cited as 10,000-file ingestion or database evidence.                                                                                                                                                                                       |
| Release gate       | Focused browser checks, the final 1,000-image stress run (including input-to-paint), six-format previews and synthetic 10,000-record rendering have passed. Clean-clone install/start/default-browser launch and library creation also passed through an isolated Linux XDG association and real headless Chromium. The full integrated command chain and GitHub CI also passed (170 unit tests, 9 E2Es); the version report links the exact implementation commit and run. Two controlled directory-response race regressions are included. |

The current Linux environment has verified Node 22.23.3, pnpm 10.34.6, published SQLite/Sharp prebuilt operation, and a provisioned Chromium launch. It cannot install system packages as root and has restricted Playwright CDN access. Local runs use the explicit `CURA_CHROMIUM_EXECUTABLE=/usr/bin/chromium` when required; this is not evidence that Playwright's pinned browser downloaded. P0 CI installed pinned Chromium; P1 CI installs Chromium plus the official Chrome channel and selects Chrome for native H.264 MP4/MOV acceptance. `scripts/codex-setup.sh` first attempts normal installation, then proves any configured fallback by launching it.

## Release checks beyond unit tests

Run the complete command chain on the final integrated commit and a clean install/start. Every P0 feature needs a real-server E2E path. Capture the three-column workspace screenshot, inspect error/loading/empty states, verify diagnostics ZIP content, and retain evidence for all nine v0.1 gates in PRD/AGENTS. A local green run is separate from `gh run watch --exit-status` proving the corresponding GitHub Actions run is green.

For physical macOS/Windows, follow [SMOKE_TEST.md](SMOKE_TEST.md): automatic browser opening, protected-folder permissions, long paths, locked-file errors, actual Unicode filesystem behavior, keyboard conventions, and display/scrolling remain desktop checks. Linux simulations or path tests do not prove those systems were exercised. P1 canvas/brand/media/export and P2 cloud/Agent/FCPXML checks are added with those implementations; none are claimed by the v0.1 suite.

## P0 scale and offline acceptance

Generate a fresh folder of 1,000 deterministic PNGs with:

```bash
node scripts/generate-fixtures.mjs /tmp/cura-fixtures
```

An optional second argument sets the count (1–100,000). Existing image filenames are never overwritten. Each PNG has a distinct decoded raster: landscape shapes, six color families, varied dimensions, and binary identity tiles. Half carry SD WebUI `parameters`; half carry ComfyUI `prompt` and `workflow` chunks with valid CRCs. Both carry the exact seed `18446744073709551615`, including an unquoted uint64 number in the ComfyUI execution graph. The folder contains images only, so scanning it does not ingest a fixture manifest as another asset.

`e2e/stress.spec.ts` uses the real production server and headless Chromium. It generates fixtures in a temporary directory, registers exactly 1,000, polls completion, verifies 1,000 distinct catalog hashes, and requests and decodes every thumbnail in Chromium. It checks extracted SD/Comfy metadata, tags/notes/rating/folders, saved queries, version annotations, trash/restore, retained replacement bytes, and a diagnostics ZIP response. The detail and catalog E2Es cover their corresponding browser controls.

Every measured search/filter response must be below 200 ms, including the first request. Five samples cover text, CJK substring, tag-name text, tag ID, rating, format, palette color, source, dates, dimensions, folder, combined filters, and similarity. Timings include the full local HTTP round trip and response JSON decoding; they exclude test-side schema assertions. No warm-up sample or slow sample is discarded. Playwright's `p0-stress-evidence.json` attachment retains all samples plus per-query median and worst latency.

Browser search has a separate measurement starting at the actual input event and ending after the matching result DOM has been painted (two animation frames). Five queries each must finish below 200 ms, including debounce, fetch, React update and paint. Resource timings preserve input-to-request and input-to-response portions; Playwright's transport/polling time is not counted as application latency. This prevents fast HTTP alone from masking a slow search control.

The browser loads all 1,000 records through normal pagination before testing both grid and list. At most 100 asset cards may exist in the DOM. A 120-frame sweep across each scroll range records every `requestAnimationFrame` interval and observed long task; the thresholds are p95 below 34 ms, maximum below 100 ms, and no task of 100 ms or longer. These are explicit headless-container responsiveness checks, not proof of zero dropped frames on physical macOS/Windows machines. The attachment includes frame intervals and DOM bounds so timing failures remain inspectable.

A staged unique file is moved into the registered root, and both the API and the already-open browser must show it within five seconds without a refresh. Browser HTTP and WebSocket requests to non-loopback hosts are blocked throughout the flow; any attempted external URL fails acceptance and is recorded. This establishes offline browser operation against the local server, not an operating-system-wide network capture. No account is created.

Initial fixture validation on Linux/Node 22 decoded all 1,000 PNGs with Sharp, found 1,000 distinct decoded-pixel SHA-256 hashes, and parsed all metadata and seeds without warnings. CLI checks rejected missing destinations, invalid counts, extra arguments and existing-image overwrites.

The final focused 1,000-image run on 2026-10-04 took 10.11 seconds to ingest, decoded all 1,000 thumbnails in Chromium, and measured a worst 52.07 ms across 70 HTTP search/filter samples. Five browser input-to-paint search samples ranged from 93.5 to 105.6 ms. The added file appeared at the API in 293.3 ms and in the existing browser in 884.0 ms. Grid/list rendered at most 40/15 cards, with p95 frame intervals of 16.8 ms, maximum intervals of 33.4/66.7 ms and no long tasks of 100 ms or more. There were no attempted non-loopback browser HTTP/WebSocket requests. See [the retained stress evidence](evidence/v0.1.0/p0-stress-evidence.json) and [the release report](REPORT-v0.1.0.md) for the final integrated gate. These measurements do not certify physical desktops.

## Six formats and the 10,000-record rendering check

The format E2E creates PNG, JPEG, WebP, GIF, AVIF and SVG fixtures from the same multicolor drawing. It imports them through the browser, checks exact retained bytes, dimensions, nonempty decoded thumbnails and preview rendering. Non-loopback networking is blocked, and SVG originals must be attachments. GIF acceptance covers its first-frame thumbnail; it does not promise animation playback.

The synthetic rendering E2E imports one real thumbnail, then supplies 10,000 unique asset IDs through mocked list pagination. All other endpoints still use the real server. It loads all 100 pages and sweeps grid/list over 240 frames each, requiring a nonempty view, no more than 100 rendered cards, p95 below 34 ms, maximum below 100 ms and no 100-ms long tasks. `synthetic-10000-browser-evidence.json` explicitly records the mock boundary and single distinct thumbnail. This is UI virtualization evidence only; the separate 1,000-image test supplies real ingestion/database/thumbnail evidence.

The six-format run passed with exact retained bytes, decoded previews and zero external requests. The 10,000-record rendering run passed with at most 40 grid cards and 16 list cards, p95 intervals of 16.8/16.7 ms, maxima below 17 ms and no long tasks. See [format evidence](evidence/v0.1.0/p0-six-format-evidence.json) and [synthetic rendering evidence](evidence/v0.1.0/synthetic-10000-browser-evidence.json).

## P1 coverage and release evidence

P1 keeps every P0 browser scenario and adds real-server boards (three flows), brand/CMF/all four exports, process (two flows), rich media (three flows), neutral export and selected-catalog export scenarios. The combined suite has 21 scenarios, including independent PDF decoding in native Chromium. The default test browser is Chrome; an explicit `CURA_CHROMIUM_EXECUTABLE` can select a provisioned codec-capable Chromium build. Component regressions control delayed responses, navigation races, same-tick submissions, stale versions and modal keyboard boundaries. Persistence tests exercise exact historical pins, stable generation identity, revisions, independent final owners, shutdown order, ZIP bounds and failed/corrupt exports.

- Boards E2Es use actual browser drag/drop and React Flow handles, move/resize/group nodes, save viewport and reload, exercise all four presets/custom templates, exact old-version pin replacement, matrix axis changes and revision-conflict recovery.
- Brand acceptance creates a genuine font asset and independently decodes ASE/JSON/HTML payloads, verifies retained font/logo hashes, and renders all six exported PDF pages with PDF.js. The exact HTML is rendered with every network request blocked; desktop `file://` opening remains a smoke step. PDF text is rasterized.
- Rich-media fixtures contain actual GLB/OBJ, raw/RLE PSD, PDF and H.264 MP4/QuickTime MOV bytes. Chromium decodes nonempty previews, verifies source hashes and historical cache rebuilds, rejects external resources/corrupt video, and renders Chinese PDF text and indented OBJ geometry. Native codec/WebGL support on physical desktops remains unverified.
- Neutral export uses 205 assets and 206 versions, exceeding public pagination, with organization/boards/brands/process relationships and historical dependencies. Independent Python `zipfile`, `csv` and `hashlib` checks validate entries, manifests, exact byte hashes and metadata. Catalog selection export additionally checks native modal focus and keyboard isolation.
- The production dependency license gate runs during lint. The final browser inventory hashes every output and verifies exact Adobe BSD CMaps/license, permitted JavaScript dependencies, and absence of bundled PDF fonts/ICC/optional WASM/native canvas. See [inventory](evidence/v0.2.0/browser-bundle-licenses.json).
- [UPGRADES.md](UPGRADES.md) provides a reproducible verifier that populates data through actual released v0.1 services, migrates it through P1, compares all retained values/hashes, creates new pinned records and verifies two unchanged reopens plus SQLite integrity/foreign keys. This uses temporary synthetic data only.

The v0.2 report records the completed command chain, fresh-start result and exact CI run. Performance evidence is saved separately under `evidence/v0.2.0/`; the historical P0 evidence is never replaced by newer measurements. Global cache maintenance assertions compare the actual count before clearing and after rebuilding, preserving the exact zero-after-clear check even when earlier P1 scenarios created other libraries.

Playwright documents that bundled Chromium does not include every codec from Google Chrome or Microsoft Edge ([media-codec guidance](https://playwright.dev/docs/browsers#media-codecs)). CI run 37203147377 confirmed H.264 returns an explicit unsupported state there, while all other rich formats rendered. CI therefore runs the same strict pixel-decoding checks against the official Chrome channel; video assertions are not skipped or replaced with generic-icon checks. The setup probe prints the actual browser version and declared H.264 capability.

## P2 independent FCPXML verifier

Developer and CI verification additionally uses Python 3.12 with `lxml==6.1.1` (BSD-3-Clause). Run `python3 -m pip install lxml==6.1.1` in an appropriate Python environment, then `python3 scripts/validate-fcpxml.py --prepare` before the test suite. This fetches Apple's official FCPXML 1.7 DTD, verifies its pinned SHA-256 and stores it only in ignored `.tmp/fcpxml/`. The ordinary Cura application, generated exports and `pnpm start` require neither Python nor this download. Test validation checks Apple's grammar independently of Cura's renderer.
