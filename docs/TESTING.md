# Testing

## Commands and isolation

Use Node 22 and pnpm 10.34.6 from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
```

On Linux, browser system dependencies may require `pnpm exec playwright install --with-deps chromium`. Windows may use `pnpm.cmd`. `pnpm lint` includes ESLint and Prettier; typecheck builds the shared contracts first; Vitest exercises server and web modules; E2E builds production packages before testing.

Playwright starts a real compiled server at `http://127.0.0.1:4318`, with temporary database/cache/log directories and no browser auto-open. It does not reuse an existing server. The harness stops the child and removes its temporary directories. Keep port 4318 free. `playwright-report/` and `test-results/` contain results/failure traces; milestone screenshots live under `docs/screenshots/`. The P0 UI screenshot is `v0.1.0.png`; the historical scaffold capture is `phase-0.png`.

## Coverage and evidence at the P0 integration checkpoint

The following distinguishes completed module checks from the integrated release gate. Exact test counts, commit IDs, CI links, and final milestone results belong in [PROGRESS.md](PROGRESS.md) and the version report so this methodology does not acquire stale totals.

| Area               | Verification and expected assertions                                                                                                                                                                                                                                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation         | Passing baseline checks cover health/static hosting, Host/Origin rejection, CLI settings, real SQLite migrations/timestamps/reopen, and React translation changes. The original real-server Chromium smoke path and clean install/start were verified in phase 0; see [REPORT-v0.0.1.md](REPORT-v0.0.1.md).                                                                                  |
| Media              | Integrated unit checks cover exact SD/Comfy seed parsing, text chunks and CRCs, corrupt/oversized metadata, graph ambiguity, immutable byte snapshots, palette/dimensions/pHash, EXIF, GIF/SVG behavior, NFC identity with actual NFD locators, and containment/symlink rejection. Invalid inputs must not produce fabricated metadata or mismatched snapshot/preview bytes.                 |
| Persistence/search | Integrated unit checks use real SQLite for libraries/roots, duplicate aliases and divergence, version retention, manual replacement/rescan, tags/groups/folders, annotation ownership, smart collections, settings, and atomic cross-library rejection. The 1,000-record store test covers measured search including short CJK. This is not a full HTTP/browser performance result.          |
| Runtime API        | The runtime branch's API integration tests pass with real files, SQLite, worker processing, and watchers through Fastify injection. They check registration/upload, thumbnail/file responses, retained old bytes, unchanged originals, rescan, watcher updates, organization, diagnostics, and invalid inputs. They are API integration tests, not Chromium E2E.                             |
| Catalog/preview UI | Component tests exercise local controls and mocked API interactions. Real-server catalog and preview E2Es must separately prove create/register/upload, organization/filter/restore/settings, metadata/annotations/replacement/compare, and error states. Component success alone does not establish that integration.                                                                       |
| Full P0 gate       | At this documentation checkpoint, integrated P0 browser workflows and stress acceptance are pending. Passing unit/API modules or a typechecked stress spec does not certify all P0 features, 1,000 thumbnails, under-200-ms HTTP queries, five-second browser watcher updates, or full offline operation. Record a passing integrated run and green remote CI before claiming the milestone. |

The current Linux environment has verified Node 22.23.3, pnpm 10.34.6, published SQLite/Sharp prebuilt operation, and a provisioned Chromium launch. It cannot install system packages as root and has restricted Playwright CDN access. Local runs use the explicit `CURA_CHROMIUM_EXECUTABLE=/usr/bin/chromium` when required; this is not evidence that Playwright's pinned browser downloaded. CI installs the pinned Chromium/system dependencies normally. `scripts/codex-setup.sh` first attempts normal installation, then proves any configured fallback by launching it.

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

The browser loads all 1,000 records through normal pagination before testing both grid and list. At most 100 asset cards may exist in the DOM. A 120-frame sweep across each scroll range records every `requestAnimationFrame` interval and observed long task; the thresholds are p95 below 34 ms, maximum below 100 ms, and no task of 100 ms or longer. These are explicit headless-container responsiveness checks, not proof of zero dropped frames on physical macOS/Windows machines. The attachment includes frame intervals and DOM bounds so timing failures remain inspectable.

A staged unique file is moved into the registered root, and both the API and the already-open browser must show it within five seconds without a refresh. Browser HTTP and WebSocket requests to non-loopback hosts are blocked throughout the flow; any attempted external URL fails acceptance and is recorded. This establishes offline browser operation against the local server, not an operating-system-wide network capture. No account is created.

Initial fixture validation on Linux/Node 22 decoded all 1,000 PNGs with Sharp, found 1,000 distinct decoded-pixel SHA-256 hashes, and parsed all metadata and seeds without warnings. CLI checks rejected missing destinations, invalid counts, extra arguments, and existing-image overwrites. The stress spec typechecked and linted; its first pre-integration run correctly failed at `POST /api/libraries` (404) because the runtime branch was not yet integrated. Full stress acceptance remains pending until a passing integrated run is recorded; this section does not claim the performance thresholds have passed.
