# Setup and local operation

Cura needs Node.js **22**, pnpm **10.34.6**, and Git. The exact CI Node patch is in `.node-version` and `.nvmrc`; the lockfile pins package versions. A network connection is needed to clone and install dependencies. Normal library use after installation requires neither networking nor an account.

## macOS: Homebrew

Install [Homebrew](https://brew.sh/) using its official instructions, then:

```bash
brew install git node@22
export PATH="$(brew --prefix node@22)/bin:$PATH"
printf '\nexport PATH="%s/bin:$PATH"\n' "$(brew --prefix node@22)" >> ~/.zprofile
npm install --global pnpm@10.34.6
node --version
pnpm --version
git clone https://github.com/Sokol13/Cura.git
cd Cura
pnpm install
pnpm start
```

Node should report `v22.x`; pnpm should report `10.34.6`. Homebrew supplies the current Node 22 patch. To match CI exactly, use the pinned patch from the [official Node.js downloads](https://nodejs.org/en/download).

## Windows: winget and the official Node installer

Install Git from PowerShell:

```powershell
winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements
```

Install **Node 22** for your Windows architecture from the [official Node.js downloads](https://nodejs.org/en/download). Keep npm and PATH support enabled. An unversioned `OpenJS.NodeJS.LTS` winget install may select a newer major, so check the version before using it. Compiler/Visual Studio tools are not needed for Cura's native dependencies.

Open a new PowerShell window:

```powershell
node --version
npm.cmd install --global pnpm@10.34.6
pnpm.cmd --version
git clone https://github.com/Sokol13/Cura.git
cd Cura
pnpm.cmd install
pnpm.cmd start
```

The `.cmd` suffix avoids PowerShell restrictions on npm/pnpm `.ps1` wrappers. Use `pnpm.cmd` in place of `pnpm` elsewhere in these docs if required. Ordinary use runs on native Windows Node; WSL is not required.

## Start, stop, and configure

`pnpm install && pnpm start` is sufficient on a shell supporting `&&`; older PowerShell can run the two commands on separate lines. Start builds all packages, starts the local server, and opens the default browser at [http://127.0.0.1:3000](http://127.0.0.1:3000). If the browser does not open automatically, visit that URL. Keep the terminal running and stop with Ctrl+C.

[http://127.0.0.1:3000/api/health](http://127.0.0.1:3000/api/health) should return HTTP 200 with `{"status":"ok"}`. Binding stays on `127.0.0.1`; Host/Origin validation prevents serving Cura as a public site.

To choose a different port and data directory:

```bash
pnpm start --port 3100 --data-dir "/absolute/path/to/cura-data"
```

```powershell
pnpm.cmd start --port 3100 --data-dir 'C:\CuraData'
```

CLI values override the corresponding environment variables. For an already-built independent server, use `node packages/server/dist/index.js --port 3100 --data-dir ...` instead. The data override does not automatically relocate separate cache and log directories.

| Variable                   | Purpose                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `PORT`                     | API/production port; default `3000`                            |
| `CURA_OPEN_BROWSER`        | Set to `0` to suppress browser opening                         |
| `CURA_DATA_DIR`            | Override catalog, retained bytes, Inbox, and settings location |
| `CURA_CACHE_DIR`           | Override thumbnail-cache location                              |
| `CURA_LOG_DIR`             | Override log location                                          |
| `CURA_CHROMIUM_EXECUTABLE` | Developer/test-only path to an explicitly provisioned Chromium |

Use absolute directory paths. Bash example: `CURA_OPEN_BROWSER=0 pnpm start`. PowerShell example: `$env:CURA_OPEN_BROWSER = '0'`, then `pnpm.cmd start`.

## Data directories and backup

Default directories come from `env-paths('Cura', { suffix: '' })`:

| System  | Data                                    | Cache                              | Logs                                     |
| ------- | --------------------------------------- | ---------------------------------- | ---------------------------------------- |
| macOS   | `~/Library/Application Support/Cura`    | `~/Library/Caches/Cura`            | `~/Library/Logs/Cura`                    |
| Windows | `%LOCALAPPDATA%\Cura\Data`              | `%LOCALAPPDATA%\Cura\Cache`        | `%LOCALAPPDATA%\Cura\Log`                |
| Linux   | `${XDG_DATA_HOME:-~/.local/share}/Cura` | `${XDG_CACHE_HOME:-~/.cache}/Cura` | `${XDG_STATE_HOME:-~/.local/state}/Cura` |

The data directory contains `cura.sqlite` (and possibly SQLite `-wal`/`-shm` files), content-addressed snapshots under `objects/`, and uploads under `libraries/<library-id>/Inbox/`. Preferences live in the database. Thumbnails live under the cache directory's `thumbnails/`; logs use `cura.log`. Runtime files do not belong in the Git checkout or registered original folders.

**Register folder** references original files without moving, renaming, or rewriting them. It also snapshots each distinct content hash: earlier bytes remain available even after another application overwrites/removes an original. Identical content shares a snapshot. Uploads are copied into Inbox and also snapshotted; budget for Inbox copies, all unique retained versions, and thumbnails. Trash/restore and unregistering a folder do not reclaim version storage. The current UI does not provide snapshot garbage collection.

Manual **Replace file** creates a new retained version without changing the registered source file; rescanning that unchanged source does not undo the replacement. A later actual source change is indexed as a new version. Logical folders/tags/annotations change the catalog only.

For a consistent backup, stop Cura and copy the **whole data directory**, plus registered original folders you still edit. Backing up only `cura.sqlite` omits retained bytes and Inbox files. Cache thumbnails can be rebuilt from Settings. Whole-library portable export is P1; copying the data directory is the current local backup procedure, not that future export format.

## Permissions and import problems

- **macOS EPERM/EACCES:** For protected Desktop, Documents, Downloads, or Pictures folders, allow the terminal or Node under **System Settings → Privacy & Security → Full Disk Access**, reopen the terminal if needed, then retry registration/rescan.
- **Windows locked files/permission errors:** Close applications holding the file, check that your account can read the registered folder and write the Cura data/cache/log directories, then retry. Do not change originals to recover the catalog.
- **Unavailable root:** Reconnect the drive or restore access, then rescan. Unregistering stops watching without deleting originals or retained versions.
- **New file not yet visible:** Wait for the writing application to finish. Check scan/error status and try Settings → Rescan if needed. A file changing during ingestion is not published as a mixed or incomplete snapshot.
- **Missing thumbnail:** Unsupported/corrupt files remain manageable with a generic icon. Raster decoding is bounded to 100 million pixels; SVG input is bounded to 8 MiB. GIF previews use the first frame. PNG metadata parsing is bounded and reports warnings in raw parameters.
- **Upload rejected:** Browser import/replacement accepts at most 100 MiB per file. Names must be portable filenames, not paths or Windows reserved device names.
- **Port already used:** Stop the other Cura process or select another port. Do not run two servers against the same data directory.

Export **Settings → Export diagnostics** after reproducing a problem. The ZIP contains `diagnostics.json` (system/runtime/version, database statistics, latest registered-folder scans, thumbnail worker queue, retained-version preview counts and database integrity/foreign-key results) and `logs.json` (the last 200 warnings/errors/fatal records, retained across restarts independently of HTTP traffic). Each section reports unavailable/partial capture explicitly. It excludes asset bytes, full metadata, credentials and file paths; scan root IDs, stages, error codes and extension counts remain useful for debugging. Inspect the archive before sharing. If Cura cannot start, include the terminal error and relevant `cura.log` lines. See [SMOKE_TEST.md](SMOKE_TEST.md) for the desktop report checklist.

## Native modules and development

Installation verifies published better-sqlite3 and Sharp native binaries with a real SQLite query and image encode/decode. There is no compiler fallback. If a prebuilt is unavailable, check Node 22, OS/architecture, optional dependencies, and access to the package/prebuild download hosts; retry a normal install. Do not use `--ignore-scripts` or remove optional Sharp platform packages. [DEPENDENCIES.md](DEPENDENCIES.md) explains native notices.

For development:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Vite proxies API requests to port 3000, or the `PORT` set before `pnpm dev`. Server, web, and shared code reload during development. Startup applies existing database migrations; `pnpm db:generate` is for schema development, not normal installation.

For automation, install Chromium with `pnpm exec playwright install chromium chrome`; Linux may need `pnpm exec playwright install --with-deps chromium chrome` and root/sudo for system packages. GitHub CLI is only needed for repository publishing or the cloud setup script (`brew install gh` / `winget install --id GitHub.cli -e`). The repeatable `bash scripts/codex-setup.sh` checks tools, dependencies, a real browser launch, and GitHub authentication. Git Bash supplies Bash on Windows. [CODEX_ENV.md](CODEX_ENV.md) documents the cloud toolchain and constrained-browser fallback; [TESTING.md](TESTING.md) lists validation commands.

Full P1 E2E selects the installed Chrome channel by default because Playwright's bundled Chromium omits H.264 codecs. An explicitly provisioned `CURA_CHROMIUM_EXECUTABLE` overrides that choice and must support H.264 for the video gate. `scripts/check-chromium.mjs` verifies launch/rendering and declared codec availability; rich-media E2E verifies actual decoded pixels. This does not install or bundle a browser for normal `pnpm start`, which opens the user's default browser.
