# Blockers and environment limitations

## Resolved

- AGENTS.md was initially absent because the repository had no commits. The supplied origin/main commit `af345fc` was fetched and its full specification was read before finalizing the scaffold.
- Initial Node 24 did not meet the project requirement. Official Node 22.23.3 was installed with TLS and SHA-256 verification; all project validation uses Node 22. The draft requests CODEX_ENV_NODE_VERSION=22.
- Initial GitHub API requests were denied by the proxy. GitHub authentication and API access subsequently recovered and the repository's push permission was confirmed. No token replacement was needed.

No phase-0 release blocker remains: local acceptance, GitHub CI and the automatic v0.0.1 Release were verified.

## Current-container limitations

- The instance has no sudo/root package-installation capability. Playwright's `--with-deps` OS-package step cannot run here. Its required shared libraries are already present and were verified by launching a real browser.
- Playwright browser-download endpoints return HTTP 403 through this instance's proxy. Official CDN domains have been added to the cloud draft. Local E2E uses the provisioned `/usr/bin/chromium` through an explicit override; CI uses the normal pinned Chromium download. No proxy bypass or TLS bypass was used.
- macOS and Windows desktop integration cannot be executed in this Linux container. Follow SMOKE_TEST.md on those platforms.

These limitations do not prevent local development with the documented provisioned-browser configuration. Remote CI and release outcomes are recorded only after actual checks in PROGRESS.md. A saved environment draft alone does not apply or publish it.
