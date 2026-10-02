# Cura

Cura is a local-first visual asset manager. This repository currently contains **phase 0 only**: development tooling, a placeholder home page, a health API, SQLite infrastructure, and automated checks. Asset-management features are not implemented yet.

## Quick start

Use Node.js **22** (the exact version is in `.node-version`) and pnpm **10.34.6**. See [SETUP.md](docs/SETUP.md) for installation from scratch, [CODEX_ENV.md](docs/CODEX_ENV.md) for Codex Cloud, and [AGENTS.md](AGENTS.md) for project requirements.

On macOS, after installing the prerequisites:

```bash
git clone https://github.com/Sokol13/Cura.git
cd Cura
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

On Windows, open PowerShell after installing Node 22, Git, and pnpm:

```powershell
git clone https://github.com/Sokol13/Cura.git
cd Cura
pnpm.cmd install --frozen-lockfile
pnpm.cmd build
pnpm.cmd start
```

The server hosts the built frontend at `127.0.0.1:3000` and opens the default browser on desktop systems. It binds only to the loopback interface. Set `CURA_OPEN_BROWSER=0` in a headless container. Running the application does not require a GitHub account; GitHub authentication is needed for development operations and the cloud setup check.

![Phase 0 home page captured by Playwright](docs/screenshots/phase-0.png)

## Development

```bash
pnpm dev
```

The frontend uses `127.0.0.1:5173`, with API requests proxied to `127.0.0.1:3000`. Shared types, server code, and web code are watched for changes.

| Directory         | Responsibility                                                         |
| ----------------- | ---------------------------------------------------------------------- |
| `packages/shared` | Zod API contracts and shared TypeScript types                          |
| `packages/server` | Fastify, Drizzle, better-sqlite3, user directories, and static hosting |
| `packages/web`    | React, Vite, Tailwind, and the placeholder home page                   |
| `e2e`             | Real-server tests in headless Chromium                                 |
| `scripts`         | Repeatable cloud setup and SQLite prebuilt verification                |
| `docs`            | Setup, environment configuration, progress, and decisions              |

`GET /api/health` returns HTTP 200 and `{"status":"ok"}`, validated against the shared contract. Database, cache, and logs live in operating-system user directories; see [data directories](docs/SETUP.md#data-directories).

## Quality checks

```bash
pnpm exec playwright install chromium
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
```

On Linux, install Chromium system libraries with `pnpm exec playwright install --with-deps chromium`. `pnpm lint` runs ESLint and Prettier; `pnpm format` applies formatting. E2E builds the project and starts an isolated real server with temporary data directories.

GitHub Actions runs these checks on pushes and pull requests. A `v*` tag triggers validation and an automatic Release with generated notes. [PROGRESS.md](docs/PROGRESS.md) records actual validation and publication status; [TESTING.md](docs/TESTING.md) distinguishes container checks from macOS/Windows smoke tests.

## License

[MIT](LICENSE)
