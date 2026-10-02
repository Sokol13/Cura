# v0.0.1 phase 0 report

## Scope

Delivered the Node 22/pnpm workspace, shared contracts, loopback Fastify server, React/Vite/Tailwind placeholder, SQLite/Drizzle infrastructure, operating-system data paths, repeatable setup and CI/release automation. No asset-management or other business features were implemented.

## Verified before tagging

- 23 server tests, 2 web tests and 1 real-server Chromium E2E passed, together with lint, typecheck and build.
- Setup repeated successfully; native SQLite uses a verified prebuilt binary without source compilation.
- A fresh HTTPS clone with no node_modules completed setup, production build/start and HTTP health/homepage checks. The full quality chain also passed in that clone.
- Both browser and server hot reload were exercised; Host/Origin rejection and CLI startup from an unrelated working directory were verified.
- Windows-style Git checkout kept shell scripts in LF. Actual Windows/macOS desktop testing remains the SMOKE_TEST.md checklist.
- [Initial CI](https://github.com/Sokol13/Cura/actions/runs/37030932058) passed; gh run watch --exit-status returned success.

## Publication

- [Release v0.0.1](https://github.com/Sokol13/Cura/releases/tag/v0.0.1) was automatically published with generated notes; it is not a draft or prerelease.
- Tagged source: `cef0f4b26030d0cd6e10f8c278f0afa2ad5e0957`.
- [Tag CI](https://github.com/Sokol13/Cura/actions/runs/37031628248): success.
- [Release validation and publication](https://github.com/Sokol13/Cura/actions/runs/37031628150): success.
- Both workflows were monitored with `gh run watch --exit-status`, and the Release was checked with `gh release view`.

## Environment configuration

The tested installation script and task startup instructions are saved in the Codex environment draft. Keep CODEX_ENV_NODE_VERSION=22, retain the existing GH_TOKEN, and use CURA_OPEN_BROWSER=0 in headless Linux. This cloud image uses CURA_CHROMIUM_EXECUTABLE=/usr/bin/chromium while browser CDN access is unavailable; GitHub CI installs the pinned browser normally. See CODEX_ENV.md for the complete script and required destinations.

## Next authorized work

Stop after phase 0 publication. The next task starts at AGENTS.md section 4, phase 1 (research, PRD, architecture and task breakdown), only after the user's next instruction.
