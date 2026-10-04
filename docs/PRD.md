# Cura Product Requirements

Status: phase 1 specification. These are acceptance requirements, not claims that the features already exist. The source of scope is `AGENTS.md`, especially sections 2, 5, 6, 7, and 8. P0, P1, and P2 map to v0.1.0, v0.2.0, and v0.3.0 respectively.

## Product and intended outcome

Cura is a local-first visual asset manager for people whose files carry creative context: the character or brand they belong to, the prompt that produced them, the model and source, their place in a version sequence, and whether they are final. Users retain their original files and can take their organization and metadata with them.

A user starts a local Node service with `pnpm install && pnpm start`; Cura opens in the default browser, without an account. Core library, search, comparison, canvas, and export workflows work without network access after installation. Optional P2 cloud capabilities do not become prerequisites for local use.

Success means that a creator can find the intended asset quickly, understand how it was produced, replace it without losing its earlier bytes or context, place it in a meaningful workflow, and export it without a proprietary reader.

## Personas and user stories

| Persona                       | Working context and recurring problem                                                                                                       | Stories and observable outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI film / AIGC creator        | Many generations of characters, scenes, and props across models and platforms; filenames alone do not preserve prompts or final selections. | **A1:** Register an existing generation folder and see new images, extracted prompts, models, and seeds automatically. **A2:** Find a character by tags, shot type, source, color, or visual similarity. **A3:** Compare versions and annotate a change without losing the previous image. **A4:** Fill character-angle and scene-option slots, mark finals, and review prompt evolution and success rates. **A5:** Extract a production asset list from a script and export assets, metadata, and an editing timeline. |
| Graphic / brand designer      | Client and brand work combines logo variants, palette definitions, fonts, and guidelines that drift between folders and revisions.          | **B1:** Organize by client and brand using folders, tag groups, notes, and saved searches. **B2:** Replace a logo while retaining the old version and compare both. **B3:** Maintain a brand kit with named colors, font files, horizontal/vertical/monochrome logos, and Markdown guidelines. **B4:** Export a readable brand page and machine-readable palette/font lists, then hand over the complete library without an account requirement.                                                                        |
| Product / industrial designer | Sketches, white models, render iterations, materials, and manufacturing notes must be reviewed together.                                    | **C1:** Browse mixed image, 3D, document, and video assets, including unsupported types as manageable records. **C2:** Arrange references and assets on a canvas without duplicating originals. **C3:** Fill white-model, rough-render, and AI-render slots and compare revisions. **C4:** Maintain material samples, colors, and process notes in a CMF board. **C5:** Export a design collection with its relationships, annotations, and version history intact.                                                     |

## Information architecture

The default workspace is a dense but legible, dark, three-column professional interface with orange accents. A light theme provides equivalent functionality. The default language is `zh-CN`; `en` is always available.

| Area                     | Contents and navigation                                                                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global toolbar           | Library switcher, import / register-folder actions, full-text search, active filters, sort, view switcher, and background job progress.                                      |
| Left column              | Hierarchical logical folders, registered roots, smart folders, grouped colored tags, and recycle bin. P1 adds boards, slot templates, matrix boards, brands, and CMF boards. |
| Center column            | Virtualized asset grid or list; empty, loading, and error states; selection and bulk actions. P1 adds the active canvas, matrix, brand kit, or CMF view in this area.        |
| Right column             | Selected asset metadata, source and generation fields, rating, notes, tags, colors, final status where applicable, and related versions.                                     |
| Detail / comparison view | Large preview, zoom, image annotations, version history, and side-by-side comparison with explicit version labels.                                                           |
| Settings                 | Library and root management, thumbnail cache, language, theme, diagnostics export; optional P2 provider and cloud connection status.                                         |
| Export flow              | Asset selection or whole library, destination/download, progress, errors, and the resulting open-format files.                                                               |

Navigation and selection must survive a refresh where meaningful; persist column widths, grid/list choice, and theme/language in the user data directory. Browser-only local-file APIs are not required: folder selection uses a server directory browser, file upload uses standard browser file selection or drag and drop, and all browser/server communication uses HTTP or WebSocket.

The primary journeys are:

1. Start Cura → create/open a library → register a root or upload files → observe indexing progress → browse and inspect.
2. Search/filter or open a smart folder → select an asset → preview/annotate → replace → compare the retained earlier version.
3. Open a board/template → drag an existing asset into a slot → replace it → review matrix consistency and version lineage.
4. Build a brand/CMF collection → export its deliverables or export the entire library and verify its files and manifest.

## Shared requirements and constraints

These apply to every relevant feature below; they are not optional enhancements.

| ID       | Requirement and acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UX-01    | Every screen has useful empty, loading, and error states. Scanning and rendering show progress; a failed asset does not hide successful assets. Errors identify the affected operation and provide an actionable recovery path.                                                                                                                                                                                                                                                                                                |
| UX-02    | Space opens preview, arrow keys move between assets, Cmd/Ctrl+F focuses search, and Delete moves selected assets to the recycle bin. Shortcuts work with both `metaKey` and `ctrlKey` and do not intercept ordinary typing in editable fields. Keyboard focus remains usable through previews and dialogs.                                                                                                                                                                                                                     |
| UX-03    | Switching between `zh-CN` and `en`, and between dark and light themes, updates all shipped UI without restarting or losing work. Language and theme persist after restart. Use `-apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif`.                                                                                                                                                                                                                                                                      |
| DATA-01  | Registered original files are referenced in place: scanning, metadata edits, organization, annotations, and canvas use do not move, rename, or rewrite them. Uploaded files are copied into the library-managed Inbox. Databases, thumbnail caches, logs, and settings live only in OS user data/cache/log directories. Version archives must not overwrite a registered original.                                                                                                                                             |
| DATA-02  | Persist paths relative to their registered library root, use platform path utilities, and normalize path/name identity to Unicode NFC. NFC and NFD spellings of the same Chinese filename resolve to one logical asset; retain a usable on-disk locator on filesystems exposing NFD names. Content hash deduplication is separate from path normalization.                                                                                                                                                                     |
| DATA-03  | A completed save survives server restart. Multi-step mutations either complete consistently or report failure without losing the last valid state. Activity records make imports, replacement, restoration, and automation outcomes inspectable. Versioned SQL migrations preserve existing data; every persisted table includes `created_at` and `updated_at`.                                                                                                                                                                |
| PLAT-01  | macOS and Windows are supported on Node 22. A Windows locked file produces a recoverable operation error, not a crash or an inaccurate success state. Supported operations handle paths longer than 260 characters. A missing/unreadable root remains visible with its error and retry path.                                                                                                                                                                                                                                   |
| PLAT-02  | On macOS, EPERM when registering protected Desktop/Documents/Downloads/Pictures folders explicitly directs users to System Settings → Privacy & Security → Full Disk Access for the terminal or Node. Permission-denied scan, read, upload, replace, export, and delete operations retain a usable interface and report what failed on both platforms.                                                                                                                                                                         |
| PERF-01  | Scanning, hashing, and thumbnail work run in worker threads, off the API event loop. A deterministic fixture of 1,000 distinct images completes ingestion with 1,000 available thumbnails and no crash. A newly completed file write in a watched root becomes visible in the UI within five seconds under the same fixture workload.                                                                                                                                                                                          |
| PERF-02  | At 1,000 assets, each exercised search/filter operation responds in less than 200 ms; record server response and browser-visible result timing, fixture, and environment rather than substituting a loose timeout. Include full text, individual filters, combined filters, color, and similarity. Search remains responsive during background work.                                                                                                                                                                           |
| PERF-03  | Grid/list rendering is virtualized. With 10,000 asset records, the DOM does not grow with the entire library and scrolling remains smooth without blank-result stalls; capture a browser performance trace and report frame/long-task evidence. The v0.1.0 gate also checks smooth scrolling on the 1,000-image fixture.                                                                                                                                                                                                       |
| LOCAL-01 | No sign-up, login, telemetry service, hosted API, or network lookup is required for all P0 and P1 workflows. After dependencies are installed, block outbound networking and exercise those workflows against the loopback server, including locally served fonts/assets. Optional cloud/provider failures never disable the local library.                                                                                                                                                                                    |
| SEC-01   | The server starts independently, with configurable port and data directory. Bind only to `127.0.0.1`; reject invalid Host/Origin values. Validate API input using shared zod contracts. Reads/writes stay within registered roots and approved data directories; traversal and symlink escapes are rejected. Importing SVG, embedded metadata, or Markdown cannot execute asset-supplied scripts in the UI. Diagnostics and exports do not disclose configured credentials.                                                    |
| DEP-01   | Runtime dependencies must satisfy the MIT / Apache-2.0 / BSD / ISC allowlist. Review transitive and bundled runtime code and binaries, not only the npm package's top-level license. Borrow architectural ideas without copying GPL/AGPL source. Native modules require published prebuilt binaries; setup cannot rely on local compilation. P0 uses no external media/conversion executables, whether separately installed or bundled; this does not exclude the prescribed prebuilt better-sqlite3 and sharp native modules. |
| QUAL-01  | Every P0 and P1 feature has at least one real-server Chromium E2E path, including failure paths where material. Metadata parsing, version lineage, search, deduplication, and canvas slots have unit coverage. `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` and GitHub Actions must pass before the relevant milestone tag. Platform-simulated errors and Linux E2E evidence must not be described as verified macOS/Windows behavior.                                                                               |

The [architecture specification](ARCHITECTURE.md) must map these workflows to every minimum entity in AGENTS.md section 8, define their relationships, and preserve the shared persistence and adapter contracts. Product acceptance covers the behavior; that entity inventory remains an implementation requirement.

**P1 media licensing constraint:** AGENTS.md names `ffmpeg-static` for MP4/MOV thumbnails while requiring permissively licensed runtime dependencies. An npm wrapper's license does not establish that its FFmpeg binary and enabled codecs meet that allowlist. The approved implementation must reconcile these requirements with verified license evidence; a compliant alternative must still deliver both MP4 and MOV first-frame thumbnails on the supported platforms. The same review applies to bundled native libraries elsewhere in the stack. This is an implementation/release constraint, not authorization to remove a P1 feature or call an unimplemented thumbnail path complete.

## P0 — usable local image library (v0.1.0)

The nine groups below correspond one-for-one to AGENTS.md section 6 P0 items.

### P0-01 — Libraries, intake, watching, and deduplication

Stories: A1, B1, C1.

- **Create/open:** Create a named library, close/reopen it, and switch between two libraries without mixing their assets or settings. Restarting preserves the current library and its metadata. Invalid or inaccessible locations yield recoverable errors.
- **Register folder:** Navigate directories through the server browser, register an existing root, and index nested files without moving/renaming/modifying any originals. Show scan totals, progress, completion, and per-file failures. Re-registering the same normalized root does not duplicate it.
- **Upload:** Drag/drop or choose several files; copy them into Inbox, preserve their source files, index them, and report individual failures. Filename collisions never silently overwrite another file. A rejected/cancelled upload cannot leave a searchable half-written asset.
- **Watch:** Add, change, rename, and remove files under a registered root and observe incremental UI updates without manual rescanning. Finished new files meet the five-second limit. Bursts, partially written files, and restart/rescan do not create duplicate assets; absent files display their unavailable state without erasing metadata/history.
- **Deduplicate:** Import identical bytes through repeated scans and uploads and do not create duplicate logical assets. Preserve enough location information to keep a referenced asset usable when one duplicate location disappears. Different bytes at unrelated locations remain distinct. A change to an existing watched source or an explicit replacement creates a version relationship rather than an unrelated asset. Unit tests cover content hashes and NFC/NFD Chinese-name identity.

### P0-02 — Three-column library workspace

Stories: A2, B1, C1.

- Display the folder tree, smart folders, and grouped tags on the left; switch between virtualized grid/list in the middle; show the current selection's metadata on the right.
- Create, edit, and delete a smart folder's saved filter rules; opening it evaluates current asset metadata so changes and newly matching assets appear automatically. It is a saved view, not a copy.
- Persist layout state across reload/restart; resizing columns does not make essential controls unreachable. Multi-selection and keyboard selection stay consistent when changing view or sorting.
- Demonstrate 10,000-record virtual scrolling and the 1,000-image performance gates; include empty library, scan-in-progress, no-results, and unavailable-root states.

### P0-03 — Supported image formats and fallback assets

Stories: A1, C1.

- Valid PNG, JPG/JPEG, WebP, GIF, SVG, and AVIF fixtures each import, display a thumbnail, open in preview, and expose supported dimensions/metadata. A GIF thumbnail may be a representative frame; original bytes remain available.
- Unsupported file types remain visible with a generic type icon and support tags, notes, rating, search, folders, recycle/restore, and export when that export capability ships.
- A malformed or unsupported rendering payload produces a clear per-asset preview/thumbnail error and a generic fallback. The rest of the scan and library remain usable. SVG rendering cannot execute embedded scripts or fetch arbitrary external resources.

### P0-04 — File and generation metadata

Stories: A1, A2, B1, C1.

- Extract pixel dimensions, byte size, available EXIF fields, and a representative palette of five to eight colors when the image contains that many distinct colors. Low-color images expose the actual distinct palette rather than fabricated colors. Files without EXIF still ingest successfully.
- A constructed SD WebUI PNG with `parameters` displays its positive prompt, negative prompt, model, seed, source, and other parsed parameters automatically after import, without a manual extraction action.
- A constructed ComfyUI PNG with `workflow` and/or `prompt` JSON displays the discoverable prompt, model, seed, source, and raw structured parameters automatically. Multiple or unrecognized nodes do not discard the original metadata or prevent indexing; unavailable fields remain explicit.
- Parse available Midjourney-related fields into the common prompt/model/seed/source fields without inventing absent values. Fixtures cover non-ASCII text, multiline prompts, missing keys, malformed JSON, and oversized/invalid chunks without crashing ingestion.
- Users can manually edit prompt, negative prompt, model, seed, source, and supported descriptive metadata; edits persist, update search, and remain distinct from the unchanged original file. Reopening or rescanning does not silently erase user edits.

### P0-05 — Organization, bulk actions, and recycle bin

Stories: A2, B1, C1.

- Create, nest, rename, and reorganize logical folders; prevent cyclic parent relationships. Moving an asset between logical folders does not move registered original bytes.
- Create colored tags and tag groups for shot type, style, version, source, and custom categories. Assign/remove multiple tags, edit colors/names, and retain relationships after restart. Tag management and source metadata remain separately understandable.
- Set and clear star ratings and notes. Bulk add/remove tags, change ratings, organize, and recycle selected assets with a clear affected count and accurate partial-failure reporting.
- Delete/keyboard Delete moves an asset to the recycle bin, excluding it from ordinary search while preserving file references, metadata, annotations, and versions. Restore returns it to normal use. Permanent removal is explicit, and deleting a catalog reference must not silently delete a registered original.

### P0-06 — Full text, filters, color, and similarity

Stories: A2, B1, C1.

- FTS5 searches filenames, tag names, prompts, and notes; Chinese and English fixtures produce the documented matching behavior. Changes to searchable metadata appear without restarting. Empty, quoted, punctuation-containing, and no-match queries do not cause errors.
- Combine filters for format, tags, rating, color, source, date, and dimensions; display active filters and allow individual/all reset. Document and test the meaning of multiple tags and range boundaries so displayed counts agree with returned results.
- A selected color returns and orders plausible palette matches. Similarity search from an asset uses perceptual hashes: exact and lightly resized/recompressed variants rank closer than visually unrelated fixture images; unsupported assets report that similarity is unavailable.
- Sorting and paginated/virtualized loading preserve stable ordering and selection. Saved smart-folder rules reproduce the same result set. All search and filter types meet the less-than-200-ms 1,000-asset gate.

### P0-07 — Asset detail and image annotations

Stories: A3, B2, C3.

- Open a large preview from the grid/list or Space; zoom and return to fit view; move to adjacent assets with arrow keys; close preview and retain the earlier selection.
- Add, edit, and delete anchored text annotations on an image. Store positions independently of displayed pixel size so anchors stay on the same feature after zoom, window resize, and reload.
- Display version history with labels and metadata, and open a specific version. Annotations identify their associated asset version so replacing the current image does not silently relocate comments onto unrelated content.
- Unsupported or unavailable files retain accessible metadata and version information while explaining why a large preview is unavailable.

### P0-08 — Version lineage, replacement, and comparison

Stories: A3, B2, C3.

- Replacing an asset through Cura creates V2 after V1, then V3 after V2, in one lineage. Preserve the previous version's exact file bytes and version-specific metadata before changing the current pointer. A hash or thumbnail alone is not an archive.
- A previously indexed watched file overwritten externally also retains the earlier version through a stored prior snapshot; its earlier bytes cannot be recovered by rereading the already overwritten source. Restarting Cura or removing the external source does not make archived bytes disappear.
- A failed replacement leaves the earlier current version usable and reports the error. Repeated watcher events for unchanged bytes do not create artificial version increments.
- Choose any two retained versions, show both side by side with unambiguous labels and preview access, and verify their bytes differ as expected. Unit tests cover ordering, stable lineage, duplicate events, and failure recovery; a real-server E2E replaces a file and compares the retained old version.

### P0-09 — Settings and diagnostic export

Stories: A1, B1, C1.

- Manage libraries and registered roots; expose unreachable roots and support retry/rescan. Removing a root/library registration explains the effect and does not silently delete original files.
- Inspect thumbnail cache usage and clear/rebuild thumbnails; rebuilding preserves assets and metadata. Surface progress and failures without blocking browsing.
- Change and persist language, theme, and layout preferences with feature-equivalent translated controls.
- Download a valid ZIP containing OS/runtime information, Cura version, recent error logs, and database statistics. The archive is inspectable offline and excludes secrets and unnecessary asset file contents. Export failures provide a retryable error.

## P1 — canvas workflow and designer extensions (v0.2.0)

All P0 behavior remains supported. The eight groups correspond one-for-one to AGENTS.md section 6 P1 items.

### P1-01 — Infinite canvas / boards

Stories: C2, A4.

- Create, name, reopen, and delete boards; pan/zoom, place assets freely, group/ungroup them, draw/edit/remove connections, and add/edit text notes. Positions, groups, connections, and notes survive reload and restart.
- A placed asset references the existing library asset instead of copying its bytes. Metadata/version updates remain traceable from the board; a removed or unavailable asset shows a resolvable placeholder rather than breaking the board.
- A real-server E2E creates a board with multiple asset items, group, connection, and note, then reloads and verifies the saved layout.

### P1-02 — Slot-based asset frames and templates

Stories: A4, B3, C3.

- Provide character, scene, product, and brand templates. Their preset slots cover setting/reference image, close-up, wide shot, 35° view; white model, rough render, AI render; and horizontal, vertical, and monochrome logos where applicable.
- Create a board from a template, drag an existing asset into an empty slot, and immediately mark that slot's selection final. The action retains a reference to the underlying asset.
- Replace a filled slot and advance its version history while retaining the earlier selected asset/version and bytes. Other slots and views do not silently change their final selection. Final status has an explicit owner so process statistics can count it consistently.
- Slot state, template relationship, final selection, and lineage survive restart. Unit and E2E tests cover first assignment, replacement, repeated assignment, and a failed update.

### P1-03 — Consistency matrix boards

Stories: A4, C3.

- Create character × angle/expression and scene × option matrices with editable row/column labels. Each cell is a slot with empty, final, unavailable, and versioned states.
- Drag assets into cells, replace a cell's asset, inspect its lineage, and compare neighboring references without losing matrix context. Adding/reordering rows/columns preserves existing cell assignments; destructive removal explains its effect.
- Reopen a saved matrix and verify labels, order, references, and final selections match the saved state.

### P1-04 — Brand kits and deliverables

Stories: B3, B4.

- Create a brand with named colors represented as HEX/RGB/CMYK, registered font files, linked logo variants, and Markdown usage guidelines. Values persist, validate, and display consistently; unsupported font previews do not prevent registering/exporting the font reference.
- Render guidelines safely and select the intended logo version. Updating an asset does not erase a brand's prior version relationship.
- Export a readable brand page as both PDF and HTML; it includes the brand name, palette, fonts, logo variants, and guidelines. HTML works offline, and the PDF opens in a standard reader.
- Export a machine-readable JSON list for color/font definitions and an ASE color palette. ASE represents colors, not font files; font definitions remain in JSON and linked/exported files. Verify exported values and named colors against the saved kit and validate the resulting file formats.
- An E2E builds a kit and downloads all required formats; automated content checks verify their nonempty, meaningful contents rather than only HTTP success.

### P1-05 — CMF boards and 3D thumbnails

Stories: C1, C4.

- Create and reopen a CMF board with material-sample assets, named/valued colors, and manufacturing/process notes; add, edit, reorder, and remove entries without modifying original samples.
- Import representative GLB and OBJ files, render a frame with browser-side three.js, and return/store it through the API as the asset thumbnail. Show progress, missing-resource/parse errors, and a usable generic fallback.
- Rendering uses local registered/imported resources; it does not silently fetch model-specified remote URLs or escape approved paths. Saved thumbnails remain available after reopening the library.

### P1-06 — PSD, PDF, and video thumbnails

Stories: B1, C1.

- Valid PSD, multipage PDF, MP4, and MOV fixtures obtain thumbnails from the PSD composite, PDF first page, and video first frame respectively. Originals and ordinary asset management remain intact.
- Background conversion reports progress and individual failures; malformed or unsupported media produces a generic fallback without blocking other imports. Temporary conversion files remain in managed data/cache locations and are cleaned up.
- Offline macOS/Windows delivery must meet DEP-01 and the P1 licensing constraint. A browser-supported subset, missing external tool, mock converter, or a generic icon does not satisfy the required thumbnail formats. Real fixtures and output-content assertions are part of E2E evidence.

### P1-07 — Process assets and provider boundary

Stories: A4.

- Display a chronological prompt-evolution timeline over an asset lineage, with version, prompt, negative prompt, model, source, and final-selection state. Missing metadata is shown as missing instead of being fabricated; editing metadata updates the view consistently.
- Show hit rates grouped by model and source using generation records and final selections. Display the numerator, denominator, and percentage, count each generation once within the stated scope, handle an empty denominator, and expose unknown model/source groups. Re-selecting the same final must not inflate counts.
- Provide an external image-generation provider interface plus one mock provider that exercises request, progress/result, and failure/cancellation behavior offline. Clearly label mock results; no production generation service or platform lock-in is introduced.
- Unit fixtures verify timeline order and statistic totals; E2E follows replacement/final selection through to the timeline and grouped statistics.

### P1-08 — Neutral asset / library export

Stories: B4, C5, A5.

- Export a selected asset set or the entire library as a directory of files plus UTF-8, human-readable `manifest.json` and CSV. When downloaded as an archive, extraction yields that structure without a proprietary reader.
- Include all exported metadata and relationships: original file references and portable export paths, assets, archived versions and their bytes, hierarchy, tags/groups, ratings, notes, generation fields/raw parameters, palettes, annotations, boards/items/connections, slots/templates/finals, brands/fonts/logos/guidelines, CMF entries, smart-folder rules, and relevant activity records. Selection export includes referenced dependencies or explicitly identifies references outside the selection.
- Export paths are portable, collision-safe, and confined to the destination. CSV has correct quoting and Unicode handling; JSON preserves structures that cannot fit losslessly into a flat row. Avoid secrets and machine-specific credentials.
- Verify exported original/version file hashes against library bytes. Missing source files produce an explicit failure/exception report rather than a falsely complete export; retained versions remain exportable. Test both selection and full-library exports, inspect the manifest, and reopen representative files using ordinary tools.

## P2 — Agent and optional cloud (v0.3.0)

The three groups correspond one-for-one to AGENTS.md section 6 P2 items. Every implemented capability must be complete and tested. A placeholder, disabled button, mock-only production provider, or unconfigured integration must be reported accurately and does not count as completed functionality. The release report explains each omitted capability and its reason; P0/P1 must remain fully usable.

### P2-01 — Agent automation

Stories: A5, B1, C5.

- **Auto-tag / normalized naming:** Define a visual-model provider interface and at least one usable implementation, then process selected assets into tags and consistent names with visible per-asset results and errors. Naming respects registered-file preservation and NFC/path constraints; collisions cannot overwrite content. The user can review or undo applied catalog changes. Credentials/configuration stay outside exports and logs.
- **Archive nonfinal work:** Save and run rules that archive nonfinal assets only. Show the matched count, preserve final slot selections, and make archived assets discoverable/restorable. Re-running a rule is idempotent and never discards version bytes.
- **Script/document breakdown:** Accept a local script/document, extract separate character, prop, and scene lists, retain links to source context, and allow editing/exporting the result. Unsupported input and provider failures leave the source intact and give an actionable error.
- **Setting documents:** Generate a readable setting/specification document from selected asset metadata, including relevant prompts, versions, references, and notes. Distinguish absent data from generated suggestions and allow editing/exporting the document.
- Offline local workflows remain available when a configured remote provider is unavailable. Test adapters with deterministic fixtures and test the usable implementation within its documented environment; report any unverified live-provider requirement instead of claiming the mock proves it.

### P2-02 — Supabase sign-in, incremental sync, and shared libraries

Stories: A5, B4, C5.

- Offer optional sign-in/sign-out with clear local/cloud status. With no credentials configured, Cura starts in fully usable local mode; adapters and tests compile/run with environment-configurable settings and deterministic local substitutes.
- Incrementally synchronize changed records/files, retry interrupted work, and resume without duplicated records or losing offline edits. Resolve concurrent conflicts in favor of local changes and record both the conflict and its resolution in an inspectable log.
- Share a team library with explicit authorized membership. Include versioned `supabase/migrations/*.sql` and RLS policies; tests prove unauthenticated/unauthorized users cannot read or mutate another user's/team's data, including storage access.
- Losing the network, token expiry, or an RLS rejection reports sync status and preserves queued local work. Sign-out does not erase the local library. Test real adapter behavior where configured and identify credentials/live verification still needed in the milestone report.

### P2-03 — FCPXML export

Stories: A5.

- Export the ordered media selection/board sequence as well-formed FCPXML using an explicitly documented supported FCPXML version. Include stable media references, order, duration/timebase, and available clip names/metadata; escape Unicode and XML characters correctly.
- Resolve local media references or package the referenced files with portable relative paths. Report unsupported clips or missing timing/media information explicitly; do not produce a success message for an unusable timeline.
- Validate output structure and timing against fixtures, including stills/video, non-ASCII names, missing assets, and multiple clips. The report distinguishes automated XML/schema checks from Final Cut Pro import verification, which requires macOS.

## Milestone acceptance and evidence

These gates reproduce AGENTS.md section 2. Feature acceptance above and these gates must both pass; documentation is not a substitute for implementation evidence.

| Release    | Required completion evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **v0.1.0** | (1) In a clean environment, clone → `pnpm install` → `pnpm start` opens a browser and permits library creation. (2) A scripted 1,000-image folder registers without a crash, all thumbnails complete, and a new watched file appears within five seconds. (3) Search/filter responses are each below 200 ms at that scale and grid scrolling stays smooth. (4) Constructed ComfyUI and SD WebUI PNG fixtures automatically expose prompts/models. (5) Replacement retains previous bytes in version history and enables side-by-side comparison. (6) NFC/NFD forms of one Chinese filename count as one asset with unit coverage. (7) All of the above run offline without an account. (8) Lint, typecheck, unit tests, and real-server E2E pass, GitHub Actions is green, and every P0 feature has E2E coverage. (9) README includes macOS/Windows instructions and the full docs match the implementation. |
| **v0.2.0** | All v0.1.0 gates remain passing. All P1 feature groups pass their acceptance criteria, including slot assignment and replacement versioning, usable matrix boards, brand exports in PDF/HTML and JSON/ASE, and full-library export with files, CSV, and a readable manifest containing all metadata. Every P1 feature has E2E coverage; CI is green. Required media thumbnails satisfy both format coverage and license constraints.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **v0.3.0** | All v0.2.0 gates remain passing. Each implemented P2 capability is complete, usable, and tested; every unimplemented item is enumerated with its reason in the milestone report. Local mode works without cloud credentials. CI is green and no partial feature is presented as complete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Each milestone updates `CHANGELOG.md`, `docs/SMOKE_TEST.md`, `docs/TESTING.md`, `docs/PROGRESS.md`, and `docs/REPORT-vX.Y.Z.md`. Reports link the release and actual CI result, list completed and omitted work, describe known bugs and limitations, and identify remaining user actions such as credentials or macOS/Windows smoke tests. Linux Chromium checks, simulated permission failures, and package compatibility evidence do not establish physical-device verification.

## Explicit exclusions

No Electron or other desktop shell, installer, public hosting, mobile client, self-hosted generation service, or proprietary format that locks users in. Cura does not sell generation or require a particular generation platform. P1 includes only the generation-provider interface and mock; P2 cloud features are optional additions to the local product.
