# v0.2.0 Implementation Plan

This executes TASKS.md tasks 7–9 after the verified v0.1.0 release. Development branches may prepare independently while the final P0 documentation CI runs; P0 main/tag contains no P1 code. No user questions or approvals are needed. The coordinator owns integration, main pushes and release gates.

## Common decisions

- Keep P0 fully usable offline. Lazy-load large workspaces and media renderers; do not load PDF/3D parsers for ordinary image catalogs.
- Every domain record has UUID identity and created/updated timestamps. Validate library ownership and asset/version ownership inside transactions. PATCH schemas contain optional fields without creation defaults.
- A pin is `{assetId, versionId}`. Slots, logos, fonts and CMF samples retain exact versions when the source asset changes.
- Final selections have owners: manual per asset, or one per slot. Replacing a slot changes only that owner's selection. Store immutable slot revisions; reassigning the same pin is a no-op. Asset.finalized describes whether the current version has an active final selection.
- Process statistics count distinct recorded generations, not unknowable historical attempts. Preserve generation identity when versions are cloned during source divergence. Legacy outputs receive documented backfilled identities. Canonical source/model grouping and raw version provenance remain exportable.
- Whole-library export reads a consistent private snapshot, including trash, removed roots, aliases, all versions and relation timestamps. Never use paginated public asset lists as an export source. Exclude private internal snapshot/cache paths and credentials; include original reference roots as informative source metadata.
- Browser-generated thumbnails upload only raster bytes to a version-scoped endpoint with the expected source hash. Validate/reencode in a worker; never accept arbitrary output paths. Persist preview state/revision, make generic fallbacks uncached, and regenerate rich previews after cache clearing while a browser is connected.

## Foundation and ownership

Coordinator: dependencies, shared index exports, migration journal order, App routes/navigation, common documentation and integration. Module agents may temporarily wire these files in their own worktrees for realistic tests but must not include those borrowed changes in scoped commits.

Allocate migrations in this order (root registers the journal):

1. `0003_process.sql`: generation identity and final selections. Process owner also owns current-version finalization hooks in CatalogStore and a reusable SQL helper for final owners.
2. `0004_boards.sql`: Board, BoardItem, BoardEdge, SlotTemplate, Slot and immutable SlotRevision.
3. `0005_brands.sql`: Brand, BrandColor, BrandFont, BrandLogo, CMFBoard and CMFEntry.

Each module owns a named shared contract file and server/web directories, and supplies a typed export reader for its complete domain records. Shared index and central route calls are integrated by the coordinator. Export snapshots may use explicit known-table readers until all module readers are integrated; they must fail visibly rather than silently omit a domain.

## A. Boards and matrices

Server owner: catalog_store. Web owner: web_catalog. Agree exact shared contracts and endpoint shapes before UI implementation.

- Board lists/create/update/delete; persisted viewport, ordered matrix axes with stable IDs and optimistic revisions.
- React Flow canvas: pan/zoom, movable asset references, text, groups without cycles, connections whose endpoints belong to the same board, and saved layout after reload.
- Four presets: character (reference/close/wide/35-degree), scene (overview/detail/option), product (white/clay/AI render), brand (horizontal/vertical/monochrome logo); reusable user templates.
- Slot assignment by actual browser drag/drop or accessible picker finalizes an exact asset version. Replacement appends slot revision and preserves old pins. Histories and revision labels are visible.
- Character-by-angle/expression and scene-by-option matrices create stable row/column cells. Reordering/renaming axes does not scramble assignments.
- Tests: real SQLite isolation/atomicity/revision history; real-server E2E for free canvas, groups/edges/text, templates, slot drag/replace/history and matrix reload. No API-only test may stand in for drag/drop acceptance.

## B. Brands and CMF

Owner: release_docs (full implementation slice, despite prior task name).

- Complete library-scoped CRUD and reorder for brands/colors/fonts/logos/guidelines and CMF samples/color/process notes. Pins must remain on their chosen versions.
- Named HEX is canonical; derive RGB and explicitly unprofiled CMYK, including black. Accept meaningful RGB/CMYK entry conversions without claiming ICC-managed print accuracy.
- Safe self-contained UTF-8 HTML includes raster logo previews and user-supplied font bytes. Render a restricted Markdown subset, escape raw HTML and prohibit scripts/remote images.
- JSON contains all brand fields, timestamps, color representations and portable font/logo data. ASE uses a small standards-based RGB encoder with Unicode names and an independent decoder in tests.
- PDF uses paginated Canvas-rendered JPEG pages and a small binary PDF writer (DCTDecode, proper page tree/xref). This preserves Chinese/system/user font appearance without packaging fonts; PDF text is raster, while HTML/JSON retain editable text. Validate with an independent parser and rendered-page content, not just a file signature.
- E2E: Chinese brand, colors, registered font, pinned logo versions, guidelines, four offline exports, malicious Markdown, long multi-page PDF, CMF edit/order/reload and original byte preservation.

## C. Rich previews

Owner: media.

Approved candidate packages: three 0.180.0 MIT; ag-psd 14.3.1 MIT with only MIT base64 dependencies; pdfjs-dist 5.4.296 Apache-2.0, bundling only approved runtime assets (exclude bundled OFL fonts/CC0 profiles); @types/three 0.180.0 is development-only. mp4box 2.1.2 BSD-3-Clause may generate development fixtures; it is unnecessary in runtime if native decoding succeeds.

- GLB/OBJ render a fitted local frame via Three.js, rejecting remote resources and bounding geometry/nodes.
- PSD merged RGB8 raw/PackBits composites use ag-psd, validated in both Node and Chromium with exact pixels; reject oversized headers and explicitly report unsupported modes.
- PDF.js renders first page with local worker/resources, eval and XFA disabled. First-page fixture differs visibly from second page.
- Native video decoding captures the first decoded MP4/MOV frame. Actual H.264 MP4 and QuickTime-branded MOV probes passed despite an empty QuickTime canPlayType string. Unsupported codecs yield actionable state; no GPL FFmpeg runtime is installed.
- Bound download size, pixels, parser work and job concurrency; dispose workers, canvases, textures and object URLs. Keep original snapshots untouched. Preview uploads are version/hash scoped, worker-reencoded and revision-aware.
- E2E: actual GLB, OBJ, PSD, PDF, MP4 and MOV meaningful preview pixels; reload, history, cache rebuild, offline behavior and malformed/external-resource cases. Existing probes/fixtures are in /tmp/cura-agpsd-probe; production fixtures must be committed/generated reproducibly.

## D. Creative process and neutral export

Owner: stress_acceptance (full implementation slice).

- Shared process/export contracts; migration 0003; generation identity/final-selection helper and CatalogStore integration.
- Timeline lists version prompt/model/source/seed changes and exact final selections. Statistics group distinct recorded outputs and selected outputs by model/source with explicit zero/unknown handling. Slot owners are independent and stale pins cannot finalize a newly replaced current version.
- GenerationProvider interface plus deterministic mock produces actual locally ingestible images/metadata through the existing media pipeline. UI makes mock behavior explicit; it must be usable without credentials.
- Export selected assets or whole library as a downloadable ZIP that extracts to a folder containing all source/version bytes, human-readable manifest.json, CSV and referenced resources. Preserve exact seeds, dates, organization, annotations, boards/slots/final owners, brands/CMF and activity. Selection exports include pinned dependencies or explicitly report external references. Verify hashes and report missing retained bytes; protect portable names/collisions/CSV quoting and formula prefixes.
- Heavy compression/file reading uses bounded asynchronous work/streaming or worker jobs; APIs remain responsive. No silent truncation by default query limits.
- Unit/E2E: generation identity survives forks, ownership semantics, timeline/model/source counts, usable mock result, populated-library export with trash/removed roots/versions, independent ZIP/manifest/CSV byte inspection and selected dependency closure.

## Integration and release

1. Integrate contracts/migrations/helpers first, then full slices with central navigation and complete zh-CN/en strings. Preserve source ownership and pass focused tests after each merge.
2. Run lint/typecheck/unit/E2E and P0 1,000-image performance/offline gates. Push each completed integrated task with current PROGRESS; observe CI green.
3. Independent P1 review and targeted fixes; no repeated polishing/review loops after meaningful concerns are closed.
4. Check every v0.2 definition, write REPORT-v0.2.0/SMOKE/CHANGELOG, bump versions, verify clean startup/CI, tag only after all checks. Report and immediately continue P2.

## Shared final-selection boundary

Process owner publishes this helper and migration first so boards can use the same ownership semantics:

`setFinalSelection(database, { libraryId, ownerKind: 'manual' | 'slot', ownerId }, pin: { assetId, versionId } | null): void` in `packages/server/src/process/final-selections.ts`.

Table `final_selections` has `id`, `library_id`, `owner_kind`, `owner_id`, `asset_id`, `version_id`, `created_at`, `updated_at`, with a unique library/kind/owner key. All timestamps and IDs are retained on update; null removes only that owner's current selection. Validate pin ownership and make updates transaction-safe. Public finalization is a projection for the current asset version; historical pins remain available to boards/timeline/statistics. Board mutation and selection mutation must commit atomically. Process helper must not import CatalogStore, avoiding an initialization cycle when CatalogStore uses it.

UI modules export `BoardsWorkspace`, `BrandWorkspace`, `ProcessWorkspace` with `{ libraryId: string; onBack: () => void }` props. Brands includes CMF as its own tab. The rich-media module exports a background queue component/hook that the coordinator mounts with the active library ID. Each module registers its own i18next namespace from separate translation data files, keeping central i18n edits unnecessary. The coordinator adds lazy navigation from the library toolbar. Read-only previews and exports continue to use version-specific bytes.
