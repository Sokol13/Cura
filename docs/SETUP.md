# Local development setup

Use Node.js 22, pnpm 10.34.6, Git, GitHub CLI, and Chromium. The exact Node patch version is pinned in `.node-version` and `.nvmrc`. All platforms use the committed pnpm lockfile.

better-sqlite3 uses an upstream prebuilt binary and performs a real in-memory SQLite query during installation. The project disables fallback to node-gyp; a platform without a compatible prebuilt fails explicitly. No C++ compiler is required for SQLite. Do not bypass the repository postinstall check with `--ignore-scripts` or disable TLS verification.

## macOS: Homebrew

1. Install [Homebrew](https://brew.sh/) using its official instructions. Then run:

   ```bash
   brew install git node@22 gh
   export PATH="$(brew --prefix node@22)/bin:$PATH"
   printf '\nexport PATH="%s/bin:$PATH"\n' "$(brew --prefix node@22)" >> ~/.zprofile
   npm install --global pnpm@10.34.6
   node --version
   pnpm --version
   git --version
   gh --version
   ```

   Node must report `v22.x`, and pnpm must report `10.34.6`. Homebrew provides the current Node 22 patch. For exact CI parity, use the version in `.node-version` from the [official Node.js downloads](https://nodejs.org/en/download).

2. Authenticate for development and clone the repository:

   ```bash
   gh auth login --hostname github.com --git-protocol https --web
   gh auth setup-git
   gh auth status
   git clone https://github.com/Sokol13/Cura.git
   cd Cura
   pnpm install --frozen-lockfile
   pnpm exec playwright install chromium
   ```

3. Start development:

   ```bash
   pnpm dev
   ```

   Open `127.0.0.1:5173` in your browser. Changes to server, web, and shared packages are watched. Ctrl+C stops the process group.

## Windows: winget and the official Node installer

Install Git and GitHub CLI in PowerShell:

```powershell
winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements
winget install --id GitHub.cli -e --accept-package-agreements --accept-source-agreements
```

Download the Windows x64 or ARM64 **Node 22** installer from [Node.js](https://nodejs.org/en/download), preferably the version in `.node-version`. Keep npm and PATH support enabled. Do not install an unversioned `OpenJS.NodeJS.LTS` package: the current LTS may be newer than Node 22. Additional native-module compiler tools are unnecessary for this project.

Open a new PowerShell window to refresh PATH:

```powershell
node --version
npm.cmd install --global pnpm@10.34.6
pnpm.cmd --version
git --version
gh --version
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
gh auth status
git clone https://github.com/Sokol13/Cura.git
cd Cura
pnpm.cmd install --frozen-lockfile
pnpm.cmd exec playwright install chromium
pnpm.cmd dev
```

The `.cmd` commands avoid PowerShell execution-policy restrictions on npm/pnpm `.ps1` wrappers. Replace `pnpm` with `pnpm.cmd` throughout this documentation if needed. Git for Windows includes Git Bash for Bash scripts; regular development also works through the native PowerShell commands above, without WSL.

GitHub authentication supports development and the setup script's final check. It is not required to run the local application.

## Build, run, and test

From the repository root:

```bash
pnpm build
pnpm start
```

The server binds to `127.0.0.1:3000`, hosts `packages/web/dist`, and opens the default desktop browser. `/api/health` returns HTTP 200 and `{"status":"ok"}`. Ctrl+C stops the server. Override the port and database directory with `pnpm start --port 3100 --data-dir /absolute/path`; command-line values take precedence over their environment variables. Host and Origin checks restrict browser requests to supported local addresses.

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
```

Vitest runs server and web tests. Playwright builds the project, starts an isolated real server, opens headless Chromium, verifies the page title, and requests the health API. E2E uses temporary user directories and manages its own server; do not start another server on its test port.

On Linux, install the browser and system libraries with `pnpm exec playwright install --with-deps chromium`; installing system packages requires root or sudo. The cloud setup script includes this step. If system libraries are already installed but system-package installation is unavailable, the script verifies the existing libraries by launching a real browser. macOS and Windows usually only need `pnpm exec playwright install chromium`.

`pnpm db:generate` creates a Drizzle migration from the schema. Phase 0 already includes the initial migration, so normal installation does not need this command. Server startup automatically applies pending migrations.

## Data directories

The server uses `env-paths('Cura', { suffix: '' })`:

| System  | Database directory                      | Cache directory                    | Log directory                            |
| ------- | --------------------------------------- | ---------------------------------- | ---------------------------------------- |
| macOS   | `~/Library/Application Support/Cura`    | `~/Library/Caches/Cura`            | `~/Library/Logs/Cura`                    |
| Windows | `%LOCALAPPDATA%\Cura\Data`              | `%LOCALAPPDATA%\Cura\Cache`        | `%LOCALAPPDATA%\Cura\Log`                |
| Linux   | `${XDG_DATA_HOME:-~/.local/share}/Cura` | `${XDG_CACHE_HOME:-~/.cache}/Cura` | `${XDG_STATE_HOME:-~/.local/state}/Cura` |

The database is `cura.sqlite`; SQLite may create adjacent `-wal` and `-shm` files. The log is `cura.log`. Phase 0 creates the cache directory without producing business-data caches. Runtime data stays outside the Git checkout.

| Variable                   | Default or purpose                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                     | `3000`; changes the API port while preserving loopback binding                                                                |
| `CURA_OPEN_BROWSER`        | Set to `0` to suppress browser opening in headless environments                                                               |
| `CURA_DATA_DIR`            | Override the database directory; use an absolute path                                                                         |
| `CURA_CACHE_DIR`           | Override the cache directory; use an absolute path                                                                            |
| `CURA_LOG_DIR`             | Override the log directory; use an absolute path                                                                              |
| `CURA_CHROMIUM_EXECUTABLE` | Optional explicit Chromium path for setup verification and E2E in constrained containers; CI uses Playwright's pinned browser |

In Bash: `CURA_OPEN_BROWSER=0 pnpm start`. In PowerShell: run `$env:CURA_OPEN_BROWSER = '0'`, then `pnpm.cmd start`. If `PORT` is set before `pnpm dev`, the Vite API proxy uses the same value.

## Clean-checkout acceptance

On Linux or macOS with Node 22, pnpm, gh, and GitHub authentication available:

```bash
cd "$(mktemp -d)"
git clone https://github.com/Sokol13/Cura.git
cd Cura
bash scripts/codex-setup.sh
pnpm build
CURA_OPEN_BROWSER=0 pnpm start
```

In another terminal, run `curl --fail http://127.0.0.1:3000/api/health`; the response must be `{"status":"ok"}`. The setup script reports a warning if its final `gh auth status` fails, allowing local development to proceed. A local setup pass does not establish GitHub authentication, CI success, or release publication. On Windows, use Git Bash for the same script or the equivalent PowerShell installation commands above.
