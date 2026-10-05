# Decisions

## CI-gated publication fallback (2026-10-04)

**Decision:** Provide an inactive, explicit-request `workflow_run` publication fallback for v0.3.0. The user already authorized milestone tags/Releases after completion and green CI. The coordinator alone activates `.github/release-request.json` after reviewing all acceptance evidence; no request file is included with the fallback implementation. The complete triggering CI run must succeed for a same-repository main push, and the tested SHA must still be remote main before each publication write.

**Reason:** Interactive GitHub credentials may expire while the connected app can still publish ordinary main commits. The repository's Actions token can publish an immutable annotated tag and generated Release notes, but its tag push does not trigger the existing Release workflow. The fallback publishes within the same guarded job, validates four package versions, report readiness and all three package trees, and recovers a missing Release without retagging. Exact activation and removal steps are in RELEASE-FALLBACK.md.

**Alternatives rejected:** Publishing before acceptance evidence, creating the request as part of infrastructure work, bypassing failed CI, dispatching a workflow with unavailable credentials, treating auth errors as missing Releases, force-moving tags, or silently accepting draft/prerelease artifacts as the stable milestone.

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

## Native image verification and zero-build startup

**Decision:** Disable Sharp lifecycle builds and verify its packaged platform binary by encoding/decoding an image during root postinstall. `pnpm start` builds before launching the local server.

**Reason:** The milestone requires a clean clone/install/start without a separate build command. Rebuilding on start is simple, guarantees current source and works identically on macOS/Windows; the startup cost is acceptable for v0.1. Native module smoke checks fail visibly when a platform binary is unavailable without invoking a compiler.

**Alternatives rejected:** A complex timestamp-based build cache, requiring undocumented build steps, or letting native install scripts fall back to node-gyp.

## Manual replacement and media bounds

**Decision:** Source aliases retain their last observed source hash separately from an asset's current version. Upload replacement appends a version without editing a registered source; rescanning unchanged source bytes is a no-op.

**Reason:** The original-preservation promise otherwise conflicts with replacement: an unchanged external file could undo the new current version on every rescan.

**Alternatives rejected:** Overwriting registered sources or treating the current asset hash as the last observed source hash.

**Decision:** Bound raster decoding to 100 million pixels, SVG input to 8 MiB, and PNG text/graph work to explicit parser limits. Animated GIF thumbnails use the first frame. Palettes contain up to eight actual dominant colors; flat-color images may contain fewer than five.

**Reason:** Bounded work protects the local service from malformed files and memory exhaustion. Repeating invented palette entries would misrepresent single-color artwork.

**Alternatives rejected:** Unbounded decoding and fabricated colors. Originals remain retained and manageable when preview extraction cannot proceed.

## Native bundle notice correction

**Decision:** Preserve the actual installed native bundle notices: Sharp's npm wrapper is Apache-2.0; upstream libvips is LGPL-2.1-or-later, while the selected @img/sharp-libvips bundle declares LGPL-3.0-or-later and includes other native-component terms (including Cairo MPL-2.0). DEPENDENCIES.md inventories these distinctions.

**Reason:** Wrapper and upstream-library labels alone do not describe the shipped prebuilt bundle. The explicit mandatory-Sharp reconciliation above applies to that documented bundle, not just one library label.

**Alternatives rejected:** Describing the bundled runtime as entirely permissive or reducing all native notices to LGPL-2.1.

## Version metadata corrections and unavailable sources

**Decision:** Keep version bytes immutable, but apply manual generation-metadata corrections to the current version as well as the asset so the correction survives later replacement. Preserve unavailable source aliases for history, exclude them from duplicate-divergence counts, reconcile deletions/renames, and show retained assets with a missing-original indicator.

**Reason:** Editing a prompt must not silently lose the correction when the next version arrives. A renamed file is one continuing asset, not an active duplicate of its vanished old path. Retained snapshots remain usable even when sources disappear.

**Alternatives rejected:** Deleting catalog history with source files, counting stale aliases as live duplicates, or retaining corrections only on the mutable current-asset record.

## Search latency and verification scope

**Decision:** Use a 60 ms search-input debounce while keeping request cancellation and stale-result guards. Measure both HTTP responses and browser input-to-painted-result timing against the 200 ms acceptance bound.

**Reason:** A real-browser measurement with the former 120 ms debounce reached 200.7 ms even when the server query was fast. The corrected implementation passed at 93.5–105.6 ms without relaxing the threshold.

**Alternatives rejected:** Measuring only database calls, excluding debounce from user-visible latency, or weakening the acceptance target.

**Decision:** Validate 1,000 real generated images through the actual server/database and separately validate 10,000 synthetic paginated records for browser virtualization. Keep these evidence scopes explicit. Clean-start browser launch uses an isolated Linux default-browser association pointing to headless Chromium.

**Reason:** These tests answer different capacity questions, and the container cannot stand in for macOS/Windows desktop behavior.

**Alternatives rejected:** Claiming synthetic rows prove 10,000-file ingestion or claiming Linux browser checks validate physical desktop permissions.

## Directory navigation while typing

**Decision:** A directory listing may normalize its requested path only if the user has not edited the path since that request started. Later typing remains authoritative while outstanding browse responses settle.

**Reason:** Delayed initial home-directory listings could overwrite a chosen folder and cause the wrong directory to be registered. Two controlled deferred-response regressions reproduced initial and explicit-browse races before the fix.

**Alternatives rejected:** Disabling manual path entry, assuming local requests always finish before typing, or weakening watcher timing tests to hide unrelated scan work.

## Transitive runtime license enforcement

**Decision:** Inspect the complete installed production dependency tree in `pnpm lint`, selecting permitted branches of dual licenses and retaining only the documented mandatory Sharp native exception. Replace the optional static-serving plugin's BlueOak/glob dependency tree with a small native Node/Fastify resource handler.

**Reason:** A final full-tree audit found eight transitive BlueOak packages despite the direct dependency inventory appearing compliant. The optional plugin is not required by the fixed stack. Root-contained static file serving needs no glob enumeration or extra runtime dependencies.

**Alternatives rejected:** Treating a permissive but unlisted license as implicitly approved, pinning a web of older transitive packages, or broadening the mandatory Sharp exception to unrelated packages.

## P1 version pins, generation identity and preview ownership

**Decision:** Boards, brand logos/fonts and CMF entries pin exact asset/version pairs. Final selections have independent manual or slot owners; only a selection of the current version marks the current asset finalized. Recorded generations have stable IDs across source-divergence clones; statistics count recorded outputs, with deterministic legacy backfill and raw provenance retained.

**Reason:** Replacing an asset must preserve earlier decisions and must not silently finalize the replacement. Counting cloned history twice would inflate output counts.

**Alternatives rejected:** Mutable current-asset references, a global final boolean without ownership, and claiming recorded outputs measure unobserved historical generation attempts.

**Decision:** Browser-generated previews upload bounded PNG data against the expected immutable version hash and preview revision. The worker reencodes the bytes into private cache; generic fallbacks are not cached. Generation jobs stop before media workers and the database during shutdown.

**Reason:** Late browser work must not replace a newer preview or overwrite source files, and shutdown must drain dependent jobs before closing storage.

**Alternatives rejected:** Client-selected output paths, persistent fallback caching, and closing the database before pending jobs settle.

## P1 renderer and export dependency choices

**Decision:** Use pinned MIT React Flow 12.12.0, Three.js 0.180.0, ag-psd 14.3.1 and Apache-2.0 PDF.js 5.4.296. PDF browser workers use ES modules; exclude optional Node canvas dependencies. Native browser video decoding supplies supported MP4/MOV frames; no GPL FFmpeg runtime is distributed. PDF bundled fonts and profiles require a separate allowed-asset audit.

**Reason:** Actual raw/RLE PSD and H.264 MP4/QuickTime MOV probes succeeded. This supports the required formats within the runtime-license constraint and avoids platform binary installation. Unsupported codecs or document modes must report an explicit preview state.

**Alternatives rejected:** ffmpeg-static's GPL binary, readers failing real zero-layer PSD composites, and silently bundling OFL fonts or CC0 profiles outside the declared dependency policy.

**Decision:** Brand PDF export renders paginated raster pages using existing browser/user fonts; HTML and JSON preserve editable text. Neutral library export includes immutable version bytes and all relational metadata from a consistent database snapshot, including trash and unavailable sources.

**Reason:** Chinese output must not depend on redistributing a new font, and an export must preserve the structure needed to leave Cura. Selected exports include referenced dependencies or explicitly identify external references.

**Alternatives rejected:** ASCII-only PDF text, undocumented missing metadata, public paginated asset queries as the export source, and calling a ZIP of current files a complete library export.

## P1 review corrections and export bounds

**Decision:** Brand/CMF mutations lock target navigation until completion. Board asynchronous additions must retain the originating board/revision and cannot apply captured stale layouts. Timeline finalization atomically checks the displayed version and previous manual selection.

**Reason:** Deferred-response reproductions showed wrong-record draft replacement, lost concurrent canvas additions and finalization of unseen source replacements. A successful HTTP response alone does not establish that the current screen still owns the result.

**Alternatives rejected:** Attaching the newest revision to old layout content, silently applying responses to whichever record is currently selected, or finalizing by asset ID alone.

**Decision:** Preserve completed outputs when cancelling a mock job; the UI labels this behavior and its simulated 1.5-second stage. Treat preview transport/queue saturation as retryable while retaining explicit terminal decoder errors. Supply local Adobe BSD CMaps for Chinese PDF text and normalize OBJ grammar before allocation bounds.

**Reason:** Cancellation must not destroy already retained work; transient connectivity must not label valid bytes corrupt. Valid CJK PDFs and indented OBJ files reproduced silent or incorrect preview outcomes without these corrections.

**Alternatives rejected:** Rolling back imported output files, hiding timing races through retries, permanently failing temporary transport errors, or calling a blank PDF render successful.

**Decision:** Export ZIP STORE with streamed, verified bytes and explicit classic-ZIP bounds: 3.5 GB including JSON/CSV/README and at most 65,532 distinct file payloads plus three metadata entries. Preserve all recorded metadata, historical dependencies, trash and unavailable sources; operational errors must not expose private managed paths.

**Reason:** Images/videos are already compressed, and bounded streaming avoids whole-library buffers. Explicit limits prevent ZIP32 truncation; the UI reports oversized exports and supports smaller selected subsets. Original files remain untouched.

**Alternatives rejected:** Silent truncation, unbounded compression buffers, incomplete paginated exports and silently omitting missing/corrupt snapshots. ZIP64 can be added as a separately validated format extension.

## P1 inherited E2E assertions

Keep SVG preview URLs revision-scoped so rebuilt browser previews invalidate correctly; update the two legacy URL assertions to verify the explicit integer revision query. Cache maintenance is global across all libraries, so its round-trip E2E compares the observed pre-clear count with the rebuilt count rather than assuming only its own three files exist. Earlier P1 scenarios legitimately create other libraries. The clear-to-zero assertion remains exact. Performance limits and actual image decoding checks remain unchanged.

## Fresh-environment PDF and timer verification

**Decision:** Run PDF.js decoding in actual browser E2E, where DOMMatrix and browser image primitives exist. Keep binary PDF offsets/lengths and layout/bounds unit tests independent of Node canvas. Do not install an optional native canvas or fabricate a DOM rendering shim for this test.

**Reason:** Fresh CI correctly excluded the optional Node canvas package and exposed a parser-unit import dependency that the development environment masked through NODE_PATH. Clean verification explicitly clears NODE_PATH. The existing exported six-page PDF rendering plus the transferred exact 2×2 JPEG decoding assertion preserve independent verification.

**Decision:** Advance the watched-preview unit test's application invalidation/debounce timers deterministically, then assert the new version. Real-server E2Es still verify actual watcher timing and the five-second limit. This removes contention with the default one-second DOM query deadline without weakening user-facing performance limits.

**CI fixture budget:** The 1,000-record store benchmark retains the per-query `<200ms` assertion. Its overall test budget is 15 seconds because creating all 1,000 records and relational metadata exceeded Vitest's default five seconds on a shared CI runner (run 37202901740). This budget covers setup, not measured query latency; the real 1,000-image ingestion/search/browser gate is unchanged. The focused 20-test store suite passes with the actual query assertions intact.

## P1 browser codec acceptance

**Decision:** Full E2E defaults to the installed official Chrome channel, unless `CURA_CHROMIUM_EXECUTABLE` explicitly selects a provisioned compatible Chromium build. Setup/CI install Chromium plus Chrome and verify declared H.264 capability before testing actual MP4/MOV pixels.

**Reason:** Playwright's bundled Chromium omitted H.264 in CI 37203147377; Cura correctly reported VIDEO_CODEC for valid video while GLB/OBJ/PSD/PDF rendered. Official Chrome includes that codec, as documented by Playwright's browser guidance. The local provisioned Chromium already passed the actual pixel tests. The browser remains a user/test prerequisite and is not distributed as a Cura runtime dependency.

**Alternatives rejected:** Skipping required video tests, counting unsupported placeholders as decoded frames, weakening assertions, or adding a GPL FFmpeg runtime solely to make the test browser behave like the supported desktop browser.

## P2 integration boundaries (2026-10-04)

- Catalog naming changes nullable `displayName` in asset metadata. Original source names, aliases and historical version names never change. A shared filename policy supplies readable exported labels while preserving each exact version's original extension; a historic JPG must not inherit the current PNG suffix. Reject nonportable manual names and resolve automatic proposal collisions deterministically.
- `archivedAt` is a logical catalog field distinct from Trash. Normal queries hide archived assets; the archive view lists them, while Trash includes deleted assets regardless of archive state. Manual mixed batches are atomic: any active final owner rejects archival of the whole batch. Automated rules may skip protected assets with explicit counts. Guard and write share a transaction; final assignment restores the asset, including when the selected version is historical.
- Automation apply and selective undo compare both current-version identity and exact changed-field values, preserving later user edits. Archive age is the current version's creation time. Automation owns one typed portable reader and exact-version dependency contract shared by cloud replay and neutral export, avoiding guessed or omitted module data.
- Managed cloud roots are hidden from ordinary root APIs/watchers and sanitized in neutral export's direct SQL reader. Replay restores final-owned assets from archive, stages full graphs before visibility, and leaves existing source aliases/paths untouched.
- Independent FCPXML validation downloads and caches Apple's pinned official 1.7 DTD as a development prerequisite. The Apple DTD is not redistributed in Cura or a runtime dependency; ordinary export remains offline.

- Supabase JavaScript SDK is pinned to 2.117.2. Its transitive tslib 2.8.1 uses SPDX `0BSD`; the installed license text grants unrestricted use/copy/modify/distribution with warranty disclaimer. Zero-Clause BSD is within AGENTS.md's permitted BSD family, so the explicit automated allowlist now includes `0BSD`; this is not a new copyleft exception.

## GitHub publishing after shell-token expiry

**Decision:** Continue authorized main publication through the existing connected GitHub app. Create Git blobs/trees/commits from the tested immutable local tree, compare the resulting tree SHA, verify the expected main parent, and advance main without force. Fetch through the public repository and align clean local histories afterward.

**Reason:** The injected shell token expired during P2, while the connected app retains repository write access. The user already authorized main pushes and uninterrupted work. This preserves the exact tested content and avoids exposing, replacing or requesting credentials.

**Alternatives rejected:** Force-pushing unrelated history, publishing an unverified tree, stopping development for a token request, or treating local tests as a substitute for actual remote CI.

## P2 portability and review closure

**Decision:** Treat FCPXML generated packages and ready download locations as device-local operational artifacts. Cloud portable records include the P0/P1 domain graph and completed automation/scripts/documents, but do not recreate ready FCPXML jobs without their generated package. Neutral export retains completed FCPXML requests and their immutable dependencies; a transferred editing package uses its included relinker.

**Reason:** Restoring a ready job with another computer's package path would produce unavailable downloads and false success. The documented ZIP/manifest/request preserves interchange without treating a cache as synchronized domain data.

**Decision:** Preserve valid catalog tag labels up to the catalog's 255-character limit in historical automation snapshots, while retaining the smaller model-suggestion bound. Archive work yields between guarded batches of at most 20 assets. Concurrent folder/group moves are reconciled to a valid graph with local-parent preference and explicit conflict snapshots; merged arrays retain each domain reader's canonical order to avoid false new edits after replay.

**Alternatives rejected:** Truncating user-authored history, blocking the request thread for a whole library, accepting cyclic merged graphs, or suppressing real changes through a global order-insensitive hash.

## Isolated archive responsiveness acceptance

**Decision:** Run the existing three archive performance/cancellation tests in a single Vitest worker after all other server/web unit suites finish. The root command excludes that file only from its first recursive invocation, then explicitly runs the unchanged file before the Node tool tests. Standalone server tests still include it. No test, assertion or threshold is removed.

**Evidence and reason:** CI 37210499373 passed the complete frozen source. The documentation-only request CI 37210844246 then measured a 267.24 ms timer gap against the 250 ms bound while server and web Vitest workloads ran concurrently; preview and queue responses still met 200 ms. The same unchanged suite passes alone. A process-wide wall-clock heartbeat measures OS scheduling contention as well as archive blocking, so acceptance must isolate unrelated test workloads, matching the existing browser performance protocol. Production archive batches remain bounded at 20 assets.

**Alternatives rejected:** Raising the 250 ms limit, skipping the performance check, adding retries until green, or changing production code without evidence of an application regression.

## Optional DTD cache in local unit runs

**Decision:** On the user's smoke-test feedback, skip only the three server tests that invoke Apple's FCPXML DTD validator when `.tmp/fcpxml/FCPXMLv1_7.dtd` is absent. Resolve availability relative to the test module rather than the process working directory. Emit one preparation hint from the XML suite in a normal `pnpm test` run.

**Reason:** A clean clone does not contain the ignored, separately downloaded DTD. Ordinary local unit tests should work before developers install the optional Python verification tooling. Existing CI preparation keeps all three independent checks enabled.

**Alternatives rejected:** Downloading files during unit tests, skipping all FCPXML tests, or catching validator errors and treating a malformed cached DTD as a skip. Application code, validator behavior, package versions and release tags are unchanged.

## Desktop follow-up scope and PSD acceptance

**Decision:** The user's explicit v0.3.1/v0.4.0 request supersedes the original completed release horizon and Node-22-only requirement. Implement numbered items in order, with research/review inside the active item parallelized where useful. Do not start v0.4 implementation before the v0.3.1 tag. Existing main publication and tag authorization remains in force.

**Decision:** Generate independent PSD fixtures at the two reported endpoint dimensions and a documented 8192×8192 middle proxy; the actual three user PSD files and exact middle dimensions were not supplied. Measure elapsed server-worker import/preview time and absolute process peak RSS, including native buffers and the worker, in fresh isolated processes after fixture generation. Add a real browser registration check and distinguish these results from physical Photoshop-file validation.

**Reason:** Raising current whole-file/whole-image browser limits would exceed the 500 MB target. A bounded reader over retained snapshots can skip layer data, prefer thumbnail resources, and sample/stream only the merged composite. Native previews must preserve original dimensions and old versions, repair existing failed-preview records, and keep the prior bounded browser fallback for unsupported encodings.

**Alternatives rejected:** Claiming validation of files never received, changing originals, lifting all size/pixel caps, or decoding an entire layer tree for a thumbnail.

**PSD rendering scope:** Composite previews use opaque RGB samples; saved alpha channels are not assumed to represent composite opacity. Embedded 1033 thumbnails are corrected from BGR for both raw and JPEG data. Unsupported CMYK/32-bit composites still benefit from their embedded thumbnail. Keep browser fallback caps unchanged; recovery retries missing PSD previews once during startup in the background, and cache rebuild covers all retained versions. No new runtime dependency is introduced.

## Removing registered directories and source availability

**Decision:** Root removal defaults to logical Trash for assets that lose their last available source. The explicit offline mode keeps them in the library with saved history. Registered originals and retained snapshots are never moved or deleted. Assets still supplied by another registered root, Inbox or a managed cloud copy stay available. Already trashed assets stay trashed. Result counters distinguish all associated assets, newly trashed assets, newly offline retained assets and still-available assets; previously trashed assets need not appear in the three outcome counters.

**Reason:** Multi-source deduplication makes an asset independent from any one folder; removing a folder must not discard another active source. The source-unavailable filter uses the same current alias/managed-root rules as asset details, before pagination/counting; snapshot availability is a separate concern. Re-registering an exact canonical path reuses the removed root and source identities without silently restoring Trash or overwriting unchanged-file/manual version history. Concurrent root removal blocks new registration/rescan work for that root until it drains.

**Alternatives rejected:** Deleting originals, losing historical versions, treating retained snapshots as evidence that an original is online, creating duplicate assets on re-registration, or silently retaining every orphan in the main library.

**Review refinements:** Whole-root unavailability is confirmed with canonical-path and directory-open checks; a denied child must not mark readable siblings offline. A former directory replaced by a regular file is unavailable. Saved source-availability filters preserve absent/true/false distinctly, so the UI exposes All sources / Source file unavailable / Source file available rather than losing an imported available-only rule.

## Deterministic source-filter CI verification

CI 37269871098 reached the initialized library and loading grid but timed out on the first new source-filter test before any filter action. The parameterized available-source case passed. Control only that test's actual 60 ms query debounce with fake timers and flush startup effects before asserting the real rendered asset. This retains all API-query assertions and avoids increasing global wait budgets or changing product behavior.

## Recursive directory scan summaries and format classification

Keep one bounded operational summary per registered root in a new local-only table: identity, timestamps, terminal status, supported/skipped/read-error counters, up to 64 extension rows and 50 relative-path errors with explicit overflow counts. Running scans become interrupted on service startup; store construction alone must not change them. Persist start/final state and throttle progress writes/events to 250 ms. Empty enumeration finishes at zero rather than remaining in a running state. Reports count files, so content deduplication can produce fewer assets than supported files. Directory reads are recursive, do not follow symlinks and preserve good aliases after partial errors, cancellation or concurrent watcher changes.

Automatic new-file ingestion accepts PNG, JPG/JPEG/JPE/JFIF, WebP, GIF, SVG, AVIF, PSD, PDF, GLB, OBJ, MP4, MOV and TTF/OTF/WOFF/WOFF2. New unknown formats are counted as unsupported and skipped without hashing or snapshotting; manual browser imports/replacements remain available for generic files. Existing exact root plus NFC-relative-path aliases of generic formats keep scanning and watcher version tracking, including unavailable or trashed aliases. Their separate count makes compatibility explicit. A renamed generic file at a previously unknown path requires manual import; reading all unknown files to recognize such renames would defeat skip behavior. No new HEIC/TIFF/BMP/PSB decoder is introduced here.

The alternative of calling files skipped while still importing and snapshotting them was rejected because the summary would misrepresent disk usage and work performed. Deleting historical generic assets was also rejected. Error persistence stores bounded codes and contained relative paths, never arbitrary operating-system messages or absolute paths. The full inventory stays transient; operational summaries are excluded from cloud and neutral library graphs.

Scan reconciliation is part of the scan outcome: a database exception after file processing must change the outcome to failed, not retain completed with contradictory error totals. Always release the in-memory scan entry even if saving its terminal summary itself fails; emit SCAN_SAVE_FAILED so a transient write failure does not permanently block retries. A throw-once reconciliation regression verifies the next scan completes without duplicating versions.

## First-video-frame readiness found during item 3 regression

The first complete browser run produced a valid but incorrect black MOV thumbnail from browser-uploaded pixels while source hashes were unchanged. Its existing color assertion remains strict. A 20-trial isolated browser probe did not reproduce those incorrect pixels, but demonstrated presentation callbacks arriving both before loadeddata and up to 22.6 ms afterward. Require both loaded data and the first video-frame callback registered before loading before drawing, preserving paused time zero. Keep the existing 10-second timeout and cancel callbacks on failure/abort. On older browsers without that API, check HAVE_CURRENT_DATA across two rendering opportunities without seeking; this fallback is not claimed to provide the same presentation signal. Six deterministic regressions cover both callback orders, abort, timeout and fallback cleanup. All three real rich-media scenarios passed after the change.

## Diagnostic warning retention and independent sections

Retain the last 200 warning/error/fatal records in a separate bounded atomic JSON journal under the log directory, restoring it on startup and flushing before export/shutdown. HTTP info records cannot evict useful warnings. Wrap Fastify's logger and child loggers while forwarding their existing output, so both the production Pino logger and injected loggers use the same capture path. Export only fixed messages, known codes, timestamps, severity, validated identifiers and counts; arbitrary log objects/messages, stack traces, prompts, credentials and paths are excluded. A malformed or unwritable journal is reported explicitly while new in-memory warnings remain usable.

The diagnostic ZIP retains its existing filenames and gains independently collected latest root summaries, actual media-worker queue state, persisted browser-preview state counts, and a separate read-only worker's integrity/foreign-key results. Missing or failed sections are explicit, never represented as healthy. Scan relative paths are redacted in exported diagnostics (the application still displays them); root IDs, stages, codes and extension counts identify the affected operation. Queue inspection is synchronous and does not enqueue behind the work it describes. The server does not claim to know which browser is actively rendering a preview.

SQLite integrity checks open the live database read-only in a separate worker, include WAL state, bound issue details to 20 and finish or report a timeout within five seconds. Concurrent exports share the same check; a timed-out worker remains reserved until it exits, avoiding repeated blocked native workers. Export fixed violation codes and safe table/row references, never arbitrary SQLite messages. Retained preview states count all saved versions; a failed native raster without a browser state is not presented as a queued browser job. Empty valid EXIF has no extracted tags and is not a parse warning.

## Built-in template presentation translations

Localize the four built-in template families and all 13 slot labels through stable preset/key identities while retaining canonical saved labels. Resolve built-in origin from the board's actual template, and translate only unchanged canonical labels; a custom template using the same key or label remains user-authored text. Renamed slots remain exact. Use localized template and slot-purpose descriptions in selection/management and slot help, without adding description fields to immutable board/export data. Existing boards gain translations immediately when changing language, without a migration, version increment or autosave. Matrix axes are separately editable user data and are outside this preset fix. Changing server seed strings alone was rejected because existing templates are inserted only once and existing boards already retain their labels.

## Platform shortcut hints

All primary-modifier hints use one web formatter: prefer the browser's User-Agent Client Hints platform when available, then its legacy platform string. macOS displays `⌘ F`; Windows/Linux and an unknown non-Mac host display `Ctrl F`. This affects presentation only; keyboard handlers continue accepting both Meta and Control and respecting editable fields. A source inventory found one existing rendered primary-modifier hint, in the catalog search field. Verify actual rendered text and keyboard focus in Chromium with simulated platform metadata; do not claim that simulation is physical macOS/Windows acceptance. No new implementation-mirroring unit tests are needed for this small display change; the existing full suite and the browser probe provide verification.

## Preview explanation layout

Place the noninteractive preview status paragraph directly after the Inspector's preview button. The former paragraph shared the button's horizontal flex layout with a full-width image and was squeezed into a narrow strip. Keeping the image/expand action together and the explanation as a normal block gives the caption the full panel width, including pending/ready/error states, without changing image dimensions or introducing special error-specific CSS. Verify bilingual long messages and preview interaction in a real browser; a seeded SIZE_LIMIT state is a layout fixture, not evidence of decoder size-limit behavior.

## Node 22–24 compatibility and release gates

The package engine range is exactly `>=22 <25`, as requested; retain engine-strict and the pinned pnpm version. Keep the Node 22 development pin as the lowest maintained LTS baseline while testing current Node 22 and Node 24 releases independently. Node 23 is accepted by the range/setup check but is not an additional requested CI axis. Active installation instructions recommend current patches because transitive build dependencies may require newer minor releases. Historical Node 22 measurements remain historical.

Run every standard CI/release validation step and actual cloud acceptance on both Node majors, with distinct artifact names and a single release publisher depending on all matrix results. Keep the existing inactive release fallback and its whole-workflow/SHA protections. Node 24 native verification uses a fresh clone with independent dependencies; never reuse the Node 22 SQLite ABI binary. Existing published SQLite/Sharp prebuilts are preferred over dependency churn or compiler fallback; actual installation and runtime checks determine compatibility. The official Node 24.21.0 Linux archive was checksum-verified in a separate tool directory, leaving the established Node 22 environment intact.

## PNG tEXt compatibility

Decode only the tEXt value as fatal UTF-8 first, then decode the entire original value as Latin-1 if UTF-8 decoding throws. Keep the keyword Latin-1 and leave zTXt Latin-1 and iTXt strict UTF-8 unchanged. A literal valid UTF-8 replacement character does not trigger fallback; no per-byte or heuristic mixing is used. Existing CRC, individual/aggregate byte limits and malformed-chunk handling stay in place. This affects newly parsed files; do not rewrite saved metadata or version records through an unsolicited reparse migration. The fixture generator now includes a Chinese prompt phrase in both SD and Comfy tEXt so the existing real-worker/browser stress scenario verifies the complete path.

## v0.3.1 publication and upgrade evidence

Use the normal annotated-tag release workflow once all numbered fixes, inherited definitions and final source CI pass. Keep the consumed v0.3.0 fallback inactive and pinned; its documentation is historical, not a second publisher for the new milestones. Final acceptance uses four package versions 0.3.1 and separate Node 22/24 fresh clones. Rebuild both the exact v0.3.0 source and candidate immediately before the upgrade verifier so ignored compiled files cannot weaken source provenance. Compare all 48 legacy tables and retained bytes, then verify the additive scan table and two idempotent reopens. Preserve earlier item-specific evidence with its original source identity.

## v0.4.0 folder-first onboarding

The empty, unfiltered normal catalog offers two adjacent actions: Register local folder is primary and Import files secondary. Explain that registered originals stay in place and uploads copy into Inbox. Reuse the existing server directory browser and registration API; keep search-no-results, Trash, Archive and initial no-library states distinct. Preserve the sidebar registration entry. This implements the core local-reference workflow without requiring a new permission flow or moving originals.

The onboarding action owns a captured-library DirectoryBrowserDialog in App, using the same component and API as the sidebar without moving sidebar state or simulating DOM clicks. Close this dialog on library/workspace changes and suppress catalog shortcuts while it is open. Successful registration refreshes the current catalog; both actions remain native buttons and wrap only when the available width requires it.

## Dated Inbox storage and upgrade boundaries

New imports use the server computer's local calendar date (`YYYY-MM-DD`) and the validated NFC original filename. Add a short suffix only when the destination already exists; exclusive creation and serialized Inbox allocation protect concurrent imports and case-insensitive filesystems. Do not derive stored filenames from an asset's later display name or manual replacement. Existing content deduplication still retains separate source aliases. Allocation also reserves catalog source paths and pending migration destinations when their files are absent, so an import cannot accidentally reuse an old alias or another interrupted move’s destination.

Migrate known legacy `UUID/filename` source aliases only inside Cura's own local Inbox. Use each source's original `createdAt` interpreted in the current server timezone, rather than migration day or file modification time. Reference folders and cloud-managed roots are excluded. A local operational journal records recovery state; immutable versions, snapshots, IDs, content hashes, source `last_hash`, asset names and authored metadata remain unchanged. Update source locators and a matching primary asset locator transactionally. In particular, moving an unchanged V1 source must never undo a manual current V2.

Coordinate migration with the root's watcher, scans, imports and shutdown. Publish without overwriting existing files, retain recoverable state across interrupted filesystem/database steps, and verify ownership before removing an old path. Unresolved migration paths must not be imported as new copies. Failed or locked operations preserve bytes, produce diagnostic warnings and remain retryable. A resumed copy must still match its reservation marker or a verified prefix of the observed source before it can be overwritten; inode identity alone cannot distinguish a partial copy from later user edits. Hashing stays in a worker. Reject a bulk rename with no recovery record, migration of registered originals, and rewriting version history to match new physical paths.

## Canvas free-asset drops into slots (item 12)

- Decision: dropping one existing canvas asset onto exactly one slot copies its pinned asset/version reference into that slot and restores the free item to its original position, preserving its edges. The canvas item remains useful as a reference, and the existing atomic slot assignment owns finalization/history. Rejected: deleting the free item or issuing a second layout mutation, which could lose relationships or leave half-completed operations.
- Decision: capture the exact historical pin and target revision at drag start. A concurrent assignment must produce the existing conflict feedback and refresh; never silently substitute the asset current version or retry over a newer slot revision. Normal drops outside slots persist movement. Multiple dragged nodes or overlapping eligible slot rectangles remain ordinary movement because there is no unambiguous assignment target.

- Boundary clarification from item 12 review: the sole node actually moved by React Flow must be the clicked asset (selected ancestors can collapse a multi-selection to one moved parent). The pointer must be inside the visible canvas; an offscreen slot behind the tray cannot become a drop target. Both cases retain ordinary movement.

## Slot history comparison and attribution (item 13)

- Decision: compare immutable slot revision IDs, defaulting to the previous and newest entries. Separate slot and asset version ordinals, and read source names from the pinned historical version. Two different revision records may reference identical bytes; later asset renaming, replacement or Trash must not change those historical labels or previews. Rejected: selecting only asset IDs/current versions, which loses slot history identity.
- Decision: store an optional immutable actor snapshot on newly authored slot revisions. Use the server’s verified, unexpired signed-in account when present; otherwise label the action as Local user. Synthetic synchronization resolution is System. Older rows remain without attribution and display Not recorded; do not infer an author from the current session or operating-system username. No request may supply its own actor. Account ID/email are historical provenance, never credentials.
- Decision: keep historical source display details in a separate API view, outside portable revision records. Legacy actor fields remain omitted rather than defaulted to null, preserving existing portable semantic hashes. Add one nullable database column without rewriting old history. Preserve and validate attributed revisions through export and sync.
- Decision: comparison is read-only and retains the history list and exact-original downloads. Cleared and unsupported entries have explicit placeholders; responsive panes and keyboard-accessible revision selectors/download links are part of acceptance.

- Compatibility boundary: newly attributed portable records require updated participating sync clients because older schemas reject unknown fields. Preserve the attribution instead of silently stripping it; legacy actorless records remain byte/semantic-compatible.

## Export dependency preview and confirmation (item 14)

- Decision: compute preview membership from the same complete snapshot closure used by neutral export. Return sorted unique selected/dependent asset IDs, their counts and public reason counts. Count assets rather than retained versions or ZIP files. Group all current/historical/free board references under one deduplicated board reason; other categories may overlap. Exclude dangling weak references that do not appear in the final manifest. Rejected: counting only visible selections or adding independently estimated dependency totals.
- Decision: bind a SHA-256 preview token to library, scope, normalized selected IDs, actual included IDs and public dependency reason sets. Recompute once before job insertion and pass that exact snapshot to the worker. A dedicated `EXPORT_PREVIEW_STALE` response creates no job; the UI refreshes the preview and requires another explicit confirmation. Replacing a version or changing unrelated metadata with unchanged asset membership/reasons does not invalidate an asset-count preview. Existing API callers can omit the token; the UI always sends it. Keep the token outside persisted export requests.
- Decision: the shared export panel offers an explicit scope choice and one confirmation action, defaulting to selection when supplied. This avoids constructing two expensive snapshots at once. Freeze the request/token at confirmation, reject obsolete success/error/finally callbacks across library/selection/scope transitions, and retain existing job reconciliation. Use the board-specific extra-assets label when every additional asset is board-referenced, even if some also have other reasons; otherwise show dependent assets and a reason breakdown with an overlap explanation.
