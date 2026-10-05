# Blockers and environment limitations

## Resolved

- AGENTS.md was initially absent because the repository had no commits. The supplied origin/main commit `af345fc` was fetched and its full specification was read before finalizing the scaffold.
- During the original bootstrap, Node 24 did not meet the then-current Node-22-only requirement. Official Node 22.23.3 was installed with TLS and SHA-256 verification. Desktop feedback item 8 supersedes that restriction with `>=22 <25`; current CI runs complete Node 22 and 24 gates. The original environment draft requested `CODEX_ENV_NODE_VERSION=22`; new setups may select 24. See TESTING.md for actual validation results.
- Initial GitHub API requests were denied by the proxy. GitHub authentication and API access subsequently recovered and the repository's push permission was confirmed. No token replacement was needed.

- During P2 the injected shell GitHub token expired. Existing connected GitHub app access still permits exact-tree Git commits and non-force main updates; public fetch and remote CI inspection work. Development and publication continue through that verified route without requesting credentials.

No milestone release blocker remains. All v0.1.0, v0.2.0 and v0.3.0 gates and Releases were verified. For v0.3.0, the CI-gated fallback used the repository Actions token after complete core/cloud CI and created the immutable annotated tag and GitHub Release; its consumed request is removed from main.

## Current-container limitations

- The instance has no sudo/root package-installation capability. Playwright's `--with-deps` OS-package step cannot run here. Its required shared libraries are already present and were verified by launching a real browser.
- Playwright browser-download endpoints return HTTP 403 through this instance's proxy. Official CDN domains have been added to the cloud draft. Local E2E uses the provisioned `/usr/bin/chromium` through an explicit override; CI uses the normal pinned Chromium download. No proxy bypass or TLS bypass was used.
- macOS and Windows desktop integration cannot be executed in this Linux container. Follow SMOKE_TEST.md on those platforms.

These limitations do not prevent local development with the documented provisioned-browser configuration. Remote CI and release outcomes are recorded only after actual checks in PROGRESS.md. A saved environment draft alone does not apply or publish it.
