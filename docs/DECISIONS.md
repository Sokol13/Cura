# Decisions

## Scope and authority

**Decision:** Implement only phase 0 of AGENTS.md section 4 and stop before phase 1, as explicitly requested for this task. Use the existing isolated cloud checkout; do not create a worktree.

**Reason:** The user scoped this delivery to development infrastructure, scaffolding and CI. No asset-library, authentication, synchronization or other business features belong in this release.

**Alternatives rejected:** Implementing later milestones automatically, or inventing an AGENTS.md while it was unavailable. The repository was initially empty; after the user supplied commit `af345fc`, we fetched it, checked out `main`, read the complete specification and reconciled the scaffold with it. That prerequisite is resolved.

## Workspace and runtime

**Decision:** Use ESM packages `@cura/shared`, `@cura/server` and `@cura/web`, strict TypeScript, Node 22 and pnpm 10.34.6. Pin dependencies and commit the lockfile.

**Reason:** Separate API contracts from the HTTP runtime and browser UI while keeping phase 0 small and reproducible.

**Alternatives rejected:** Node 24 (the initial cloud default), tRPC, desktop wrappers, extra services, and speculative abstractions. Node 22.23.3 was downloaded from nodejs.org over verified TLS and verified against its published SHA-256 checksum for this instance; the reusable configuration also requests CODEX_ENV_NODE_VERSION=22.

## Development and production

**Decision:** Development runs shared type compilation, tsx watch and Vite concurrently. Production serves the built web bundle through Fastify on 127.0.0.1:3000. The server opens the default browser unless CURA_OPEN_BROWSER=0; a headless Linux session remains usable. Port and data directory are configurable; module-relative asset and migration paths do not depend on the current directory.

**Reason:** The same server can run independently now and behind a future desktop shell. Zod owns the health response contract. Validate local Host/Origin values from the beginning.

**Alternatives rejected:** Binding 0.0.0.0, a production Vite server, wildcard CORS, or hard-coded checkout paths.

## Persistence and native dependencies

**Decision:** env-paths selects operating-system Cura data/cache/log directories. Explicit CURA_DATA_DIR, CURA_CACHE_DIR and CURA_LOG_DIR overrides isolate tests. The first Drizzle migration contains only infrastructure metadata with timestamps, not business entities.

**Reason:** Starting the scaffold must not pollute the checkout or asset folders. Migration tests exercise a real native SQLite file, repeat migration and reopen it without losing data.

**Alternatives rejected:** Writing a database under the repository, an in-memory-only persistence test, and introducing the future asset schema in phase 0.

**Decision:** Disable better-sqlite3's default lifecycle build and run prebuild-install explicitly, with a real native SQLite check afterward. Never fall back to node-gyp.

**Reason:** Supported platforms must use published native binaries; unsupported combinations should fail visibly instead of demanding a compiler.

## Browser validation in a restricted cloud instance

**Decision:** The normal setup runs Playwright's Chromium installer with system dependencies. If OS package installation is unavailable, install the browser separately and prove its required libraries work by launching it. An explicit CURA_CHROMIUM_EXECUTABLE can select an already provisioned Chromium.

**Reason:** This instance has no sudo/root access and blocks the Playwright download domains at the proxy, but already provides /usr/bin/chromium. We can still run a real headless browser against a real server. CI uses the Playwright-pinned browser without this override.

**Alternatives rejected:** Disabling TLS verification, bypassing network policy, replacing E2E with mocks, silently claiming the pinned browser downloaded, or requiring root when the image already has all runtime libraries.

## GitHub authentication and publication

**Decision:** Retain gh auth setup-git in cloud bootstrap instructions and inspect gh auth status in repository setup. GitHub authentication is not a prerequisite for building or running the offline application; missing/unusable GitHub access is reported separately and never presented as a successful CI or Release.

**Reason:** The user explicitly permits local completion and commits if this instance cannot push. A proxy CONNECT 403 to api.github.com is not evidence that GH_TOKEN is invalid. Existing secret values are never printed or copied into scripts.

**Alternatives rejected:** Asking for credentials in chat, replacing an existing token without evidence, or claiming a saved network draft is already applied. Required API/browser domain additions are recorded in CODEX_ENV.md and the configuration draft.

## Verification and release gate

**Decision:** Test the real server, native database and browser, including a clean Git clone. Commit only phase 0 work to main using Conventional Commits. Publish v0.0.1 only after the required checks actually pass; do not invent a successful gh run watch or Release URL.

**Reason:** Local passing checks and a saved cloud draft do not establish remote CI or publication. External blockers must remain visible in PROGRESS.md and BLOCKERS.md.

**Alternatives rejected:** Tagging unfinished work, generating fake green statuses, and beginning phase 1 while phase 0 is blocked.

## Cross-platform text files and specification ownership

**Decision:** Normalize repository text files to LF with .gitattributes, including Windows checkouts. Preserve the user-supplied AGENTS.md verbatim and exclude that specification from automatic formatting.

**Reason:** Git Bash must receive valid LF shell scripts even when Windows Git has core.autocrlf=true. The implementation should not rewrite its governing document for cosmetic reasons.

**Alternatives rejected:** Requiring every Windows user to change global Git settings, or modifying the supplied project specification only to satisfy Prettier.

## Continuous development authorization (2026-10-04)

**Decision:** The new user request supersedes the phase-0-only scope above. Continue phase 1 through v0.1.0, v0.2.0 and available v0.3.0 work, stopping only under AGENTS.md section 1. Do not ask questions. Record unresolved choices here and prioritize incoming real-machine bug reports.

**Reason:** The user explicitly accepted phase 0 and authorized autonomous implementation, main pushes and milestone tags gated by evidence.

**Alternatives rejected:** Waiting for separate design/plan approval under Superpowers, opening unnecessary pull requests, or stopping after the first report. Use brainstorming self-answers, written plans and verified execution with parallel isolated worktrees and coordinator integration.

## Catalog ownership and version safety

**Decision:** Libraries are logical catalogs with referenced roots and a managed data-directory Inbox. Keep immutable content-addressed snapshots for all versions, including referenced files, and preserve source aliases for duplicate bytes.

**Reason:** An external overwrite destroys old source bytes. Archiving only when notified would be too late. Snapshots make version history, offline use and neutral export reliable while originals remain untouched. Disk usage is the cost and will be visible in documentation.

**Alternatives rejected:** Moving originals, storing caches inside roots, or promising recoverable versions without retaining bytes. Content-addressed snapshots avoid storing identical versions repeatedly.

## Runtime and licensing reconciliation

**Decision:** Use the existing verified Node 22 and pnpm 10.34.6 tool locations for this cloud shell; the fresh shell initially resolves Node 24/pnpm 11 despite the applied environment configuration. Preserve inherited proxy/TLS settings.

**Reason:** Actual runtime observations override configuration intent. The repository installer correctly rejected incompatible versions; no product change is necessary to bypass its checks.

**Alternatives rejected:** Relaxing Node constraints or claiming the configured environment proves the running shell is correct.

**Decision:** Follow the permissive runtime-license requirement over the conflicting P1 suggestion to install GPL-3.0 ffmpeg-static. Investigate browser video extraction and permissively licensed PSD/PDF/3D libraries, documenting exact supported formats and any unmet milestone criterion.

**Reason:** Installing the named package would violate AGENTS.md section 4. Research records upstream license evidence.

**Alternatives rejected:** Copying copyleft code, bundling unreviewed ffmpeg binaries, or describing unsupported video codecs as supported.

## PNG text and native library interpretation

**Decision:** Parse PNG tEXt, compressed zTXt and UTF-8 iTXt with size bounds. Preserve generation seeds as exact strings, including ComfyUI's unsigned 64-bit values; trace graph connections from output/sampler nodes.

**Reason:** Chinese prompts can use iTXt and JSON numbers can exceed JavaScript's safe integer range. Choosing the first text node yields the wrong prompt in common workflows.

**Alternatives rejected:** tEXt-only support, lossy Number conversion, or arbitrary node ordering.

**Decision:** Use the expressly mandated Sharp package (Apache-2.0), retaining/documenting its native libvips LGPL-2.1 notice. Interpret the generic permissive dependency list as the npm package selection rule where it conflicts with this explicit native stack requirement. Do not extend this exception to optional GPL packages such as ffmpeg-static.

**Reason:** The same specification mandates Sharp and prebuilt native image support. Replacing Sharp or claiming all bundled native components are MIT/Apache/BSD/ISC would misrepresent that specification. Dependency licensing evidence must distinguish the wrapper from native code.

**Alternatives rejected:** Silently labeling libvips permissive, removing required Sharp, or broadening the exception to unrelated dependencies. This is an explicit technical reconciliation, not a claim of legal review.

## Duplicate-source divergence and stable bytes

**Decision:** When one of several duplicate source aliases changes, fork its asset with inherited history before appending the new version. Hash, metadata and thumbnail all derive from one immutable temporary snapshot, verified against stable source stats.

**Reason:** Sharing one mutable version chain between divergent source files causes old copies to revert the latest version on rescans. Reading hash and thumbnail separately during a write can pair different bytes.

**Alternatives rejected:** Oscillating shared histories, losing old versions on divergence, or assuming a watcher event guarantees stable bytes. Active original formats download with sandbox headers; only rasterized previews render inline.

## Chinese search and persisted preferences

**Decision:** Combine FTS5 with a bounded CJK substring path for unsegmented Chinese queries, tested with one- and two-character input at 1,000 assets. Store theme/language/layout in the user-data database and mirror them in Zustand.

**Reason:** Default unicode61 token boundaries miss common short Chinese searches, and browser-only preferences would not meet the settings-location requirement.

**Alternatives rejected:** English-only token assumptions, tests with only space-separated Chinese, and localStorage as the sole settings store. The small-library substring path must pass measured latency rather than assume an index solves every script.
