# Testing

## Automated checks

Run from the repository root with Node 22 and the pinned pnpm:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
```

`pnpm e2e` builds all packages, starts its own compiled production server on 127.0.0.1:4318, uses temporary database/cache/log directories, opens the real home page in headless Chromium, checks its title and heading, and requests `/api/health` from the browser. It writes `docs/screenshots/phase-0.png` and shuts down the server. Existing services are not reused.

The server suite covers the Zod health response, static assets and unknown APIs, Host/Origin validation, CLI configuration, a real SQLite migration, timestamps and reopening the same database without losing a row. The web suite renders the real React component and switches its zh-CN/en translations.

## Current-container evidence

- Node 22.23.3 and pnpm 10.34.6 were used.
- `pnpm lint`, `pnpm typecheck`, and `pnpm build` passed.
- Vitest: 23 server tests and 2 web tests passed; none skipped.
- Playwright: 1 real-server Chromium E2E passed; screenshot captured.
- better-sqlite3 downloaded a published prebuilt binary, performed a native SQLite query, and reused it successfully on repeat installation. No node-gyp build ran.
- `bash scripts/codex-setup.sh` passed twice from a different working directory. The full environment bootstrap also passed, including `gh auth setup-git` and `gh auth status`.
- A real Chromium session observed a React hot update without manual refresh; tsx restarted the API after a server edit and the Vite API proxy stayed functional. Temporary edits were restored and all development processes were stopped.
- The setup script rejected the initially supplied Node 24 before installing project dependencies.
- A compiled server launched from an unrelated temporary working directory accepted its CLI port/data-directory settings, returned health 200, rejected hostile Host/Origin values with 403, and shut down cleanly on SIGTERM.

This cloud image has no root/sudo access and blocks the Playwright CDN downloads. Local browser verification used the explicitly configured `/usr/bin/chromium` (151.0.7922.173), not a claimed successful download of Playwright's Chromium 141. The repository setup still attempts `playwright install --with-deps chromium`, then verifies the provisioned browser and its libraries by launching it. GitHub CI uses the Playwright-pinned browser and installs its OS dependencies normally.

A fresh HTTPS clone into a temporary directory, with core.autocrlf=true and no node_modules, passed setup, build, pnpm start, health/homepage HTTP 200, and the entire lint/typecheck/test/e2e chain. Its working tree remained clean afterward. GitHub CI [37030932058](https://github.com/Sokol13/Cura/actions/runs/37030932058) passed every required step, including normal Chromium/system-dependency installation; gh run watch --exit-status succeeded. macOS/Windows desktop browser opening and filesystem behavior require the manual checks in SMOKE_TEST.md; Linux results are not a claim that those operating systems were tested.

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
