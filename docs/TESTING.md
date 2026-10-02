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
