# Codex Cloud environment

The checkout is `/workspace/Cura`. Use this existing isolated checkout; do not create a Git worktree. Installation prepares dependencies. Application processes must be restarted in each new task.

## Variables and credentials

| Name                       | Type                                  | Required value or purpose                                                                                                                                                            |
| -------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CODEX_ENV_NODE_VERSION`   | Required environment variable         | `22`; verify that the actual runtime reports Node `v22.x`                                                                                                                            |
| `GH_TOKEN`                 | Existing secret for GitHub operations | Preserve the existing secure binding. It must support repository access, content/workflow writes, Actions reads, and release creation. Never put its value in the repository or chat |
| `CURA_OPEN_BROWSER`        | Recommended environment variable      | `0` for headless Linux                                                                                                                                                               |
| `CURA_CHROMIUM_EXECUTABLE` | Optional environment variable         | An explicit browser such as `/usr/bin/chromium` for constrained containers. Leave unset in the standard workflow and CI to use Playwright's pinned browser                           |

The installation script below also defines writable tool/cache locations and `PLAYWRIGHT_BROWSERS_PATH`. The current container cannot write to its home or system directories, so these paths use `/workspace`. The application requires no database service or business-service credentials.

Check only credential names, presence, and operation results. Git may authenticate through the platform HTTPS proxy. A successful Git read does not establish GitHub API or write access. An invalid-token message from `gh auth status` during a proxy connection denial does not by itself prove that GH_TOKEN is invalid.

## Environment installation script

Use the following complete script in environment settings. Node 22 is provided by the environment version setting. The script installs pnpm in a writable tool directory if needed and invokes the repository installer without assuming that project dependencies exist. Installing gh when absent requires root or noninteractive sudo.

```bash
#!/usr/bin/env bash
set -euo pipefail

export CURA_TOOL_HOME=/workspace/.cura-tools
mkdir -p "$CURA_TOOL_HOME"
export PATH="$CURA_TOOL_HOME/node/bin:$CURA_TOOL_HOME/pnpm/node_modules/.bin:$PATH"
export npm_config_cache="$CURA_TOOL_HOME/npm-cache"
export npm_config_store_dir="$CURA_TOOL_HOME/pnpm-store"
export XDG_CACHE_HOME="$CURA_TOOL_HOME/cache"
export XDG_DATA_HOME="$CURA_TOOL_HOME/data"
export XDG_STATE_HOME="$CURA_TOOL_HOME/state"
export PLAYWRIGHT_BROWSERS_PATH="$CURA_TOOL_HOME/ms-playwright"
export CURA_OPEN_BROWSER="${CURA_OPEN_BROWSER:-0}"

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" != 22 ]]; then
  echo 'Node 22 is required. Set CODEX_ENV_NODE_VERSION=22 in environment settings.' >&2
  exit 1
fi
if ! command -v pnpm >/dev/null 2>&1 || [[ "$(pnpm --version)" != 10.34.6 ]]; then
  npm --prefix "$CURA_TOOL_HOME/pnpm" install --no-audit --no-fund pnpm@10.34.6
fi
if ! command -v gh >/dev/null 2>&1; then
  if [[ "$(id -u)" == 0 ]]; then
    apt-get update
    apt-get install --yes gh
  elif command -v sudo >/dev/null 2>&1; then
    sudo -n apt-get update
    sudo -n apt-get install --yes gh
  else
    echo 'GitHub CLI is missing; provide gh in the environment image or enable system-package installation.' >&2
    exit 1
  fi
fi

if ! gh auth setup-git; then
  echo 'GitHub Git authentication setup failed; continue local setup and diagnose before pushing.' >&2
fi
cd /workspace/Cura
if [[ -f scripts/codex-setup.sh ]]; then
  bash scripts/codex-setup.sh
fi
```

The `gh auth setup-git` step retains the requested environment bootstrap behavior. Keep the existing HTTPS origin `https://github.com/Sokol13/Cura.git` and platform proxy routing. Do not copy or extract credentials into files.

The repository's `scripts/codex-setup.sh` locates the checkout from its own path, checks Node 22 and the exact pinned pnpm version, then:

1. Runs `pnpm install --frozen-lockfile`, including SQLite prebuilt verification. No node-gyp fallback is allowed.
2. Runs `pnpm exec playwright install --with-deps chromium`.
3. If system-package installation is unavailable but libraries are already present, installs the browser separately and performs a real headless launch. If `CURA_CHROMIUM_EXECUTABLE` is explicitly configured, it verifies that browser. This fallback does not claim successful system-package installation or CDN download.
4. Runs `gh auth status`. A failure is reported as a warning so local development can continue under the task instructions. A successful local setup does not imply successful GitHub authentication or publishing.

The commands can run repeatedly, starting without node_modules. Installation respects the committed lockfile and does not rewrite it.

## Task startup instructions

Do not assume previous processes survive a new task. Apply the PATH, cache, and browser exports above, then begin each task as required by AGENTS.md:

```bash
cd /workspace/Cura
bash scripts/codex-setup.sh
pnpm dev
```

The API listens at `127.0.0.1:3000` and Vite at `127.0.0.1:5173`. Verify `/api/health` with a local HTTP request: expect status 200 and `{"status":"ok"}`. Verify that Vite serves the home-page HTML.

Production validation uses `pnpm build && pnpm start`. Quality validation uses `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`. E2E manages an isolated service and temporary data directories. Keep `CURA_OPEN_BROWSER=0` in a headless container. Stop only processes started by the current task.

Installation-script exports may not automatically reach later shells. Persist the non-secret variables in environment settings, or repeat the exports when opening a new shell. Retained cache/data files do not imply retained processes; cross-instance persistence depends on the platform snapshot.

## Required settings changes observed in this task

**Keep the Node 22 setting and the reusable installation script above. For this image, set CURA_CHROMIUM_EXECUTABLE=/usr/bin/chromium until the pinned-browser CDN route is available.** Runtime inspection initially differed from the supplied environment description:

- Initial Node was 24.19.0, and `CODEX_ENV_NODE_VERSION` was unset. Set `CODEX_ENV_NODE_VERSION=22` and verify the resulting runtime. For this task, official Node 22.23.3 was downloaded, checked against its official SHA-256, and installed under `/workspace/.cura-tools/node`. That local installation does not prove that the version setting has been applied.
- GH_TOKEN was present. Initial `api.github.com` requests returned HTTP 403 during proxy CONNECT, but access subsequently recovered: `gh auth status`, account lookup, and repository permission checks succeeded. No replacement token is needed. Preserve access to the API for Actions monitoring and Release creation.
- Browser downloads from `cdn.playwright.dev` and `playwright.download.prss.microsoft.com` initially returned HTTP 403. Keep those destinations permitted for Playwright's standard pinned Chromium download. This container also provides `/usr/bin/chromium`, usable through the explicit override. See TESTING.md for which browser actually passed; CI uses the standard download.
- The current container is not root and has no sudo. Its base image must already provide Chromium libraries, or permit system-package installation. The setup script verifies the actual browser launch rather than assuming those libraries exist.

Required network destinations include `registry.npmjs.org`, `nodejs.org`, `github.com`, `api.github.com`, `release-assets.githubusercontent.com`, `cdn.playwright.dev`, `playwright.download.prss.microsoft.com`, and the base image's existing package repositories. If an allowlist is used, add required domains while preserving existing entries. Keep TLS, package-signature, and artifact checks enabled.

The tested install_script, start_skill, Node 22/browser variable requirements, and additive network destinations have been saved to the environment draft. Apply/publish that draft in environment settings to use it for later tasks; no new GitHub secret is needed. A saved configuration draft does not execute its script, update the running network policy, or publish the environment. See [PROGRESS.md](PROGRESS.md) and [BLOCKERS.md](BLOCKERS.md) for actual validation and publication status.
