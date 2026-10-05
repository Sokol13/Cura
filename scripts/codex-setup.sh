#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

for tool in node pnpm gh; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing prerequisite: $tool. See docs/SETUP.md and docs/CODEX_ENV.md." >&2; exit 1; }
done
node -e 'const major = Number(process.versions.node.split(".")[0]); if (!(major >= 22 && major < 25)) { console.error("Cura requires Node >=22 <25; found " + process.version); process.exit(1); }'
expected_pnpm="$(node -p 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8")).packageManager.split("@")[1]')"
if [[ "$(pnpm --version)" != "$expected_pnpm" ]]; then
  echo "Cura requires pnpm $expected_pnpm. Run: npm install --global pnpm@$expected_pnpm" >&2
  exit 1
fi

pnpm install --frozen-lockfile
if ! pnpm exec playwright install --with-deps chromium chrome </dev/null; then
  echo 'Playwright system-package installation failed; checking whether the image already supplies the required libraries.' >&2
  if [[ -z "${CURA_CHROMIUM_EXECUTABLE:-}" ]]; then
    pnpm exec playwright install chromium chrome
  else
    echo "Using explicitly configured Chromium: $CURA_CHROMIUM_EXECUTABLE"
  fi
fi
# A real Chromium launch verifies OS libraries even on images without root/sudo.
pnpm exec node scripts/check-chromium.mjs
if ! gh auth status; then
  echo "GitHub authentication is unavailable. Local development is installed; push/Actions/Release still require working GitHub access." >&2
fi
echo 'Cura setup completed. Run pnpm dev, or pnpm build && pnpm start.'
