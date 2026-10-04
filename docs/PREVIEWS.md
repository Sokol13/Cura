# Offline rich previews

Cura generates GLB, OBJ, PSD, PDF, MP4 and MOV previews locally while a browser has the corresponding library open. A preview is a disposable raster representation of one immutable asset version. It does not replace the original, create an asset version, or change source dimensions.

## Supported inputs

| Format    | Renderer and verified behavior                                                       | Limits and exclusions                                                                                                                                                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GLB       | Three.js 0.180.0; fitted, lit frame of a glTF 2 binary scene                         | Embedded PNG/JPEG textures and binary/data resources only. External resources and all `extensionsRequired` declarations are rejected, including Draco/compressed-texture requirements. No animation playback or external material resolution.                                                                                             |
| OBJ       | Three.js OBJLoader; fitted frame with a neutral orange material                      | Geometry containing vertices and faces. External `mtllib`/texture references are rejected; this is a geometry preview, not an MTL material reproduction.                                                                                                                                                                                  |
| PSD       | ag-psd 14.3.1; merged composite, verified with independent raw and PackBits fixtures | PSD version 1, RGB, 8-bit, three or four channels, raw or RLE merged composite. PSB, other color modes/depths/compression, and layer editing are unsupported.                                                                                                                                                                             |
| PDF       | PDF.js 5.4.296; page 1 only, with a local module worker                              | Password-protected documents fail explicitly. XFA and JavaScript evaluation are disabled. No packaged standard fonts, CMaps, ICC profiles or WASM decoders: font substitution, non-embedded CJK fonts, JPEG2000 and color-profile handling are limited. Complex files can fail or render differently; this is not a print-proof renderer. |
| MP4 / MOV | Native browser decoder; first decoded frame                                          | Actual H.264 MP4 and QuickTime-branded MOV fixtures pass Chromium. Other codecs, including HEVC/ProRes when unavailable in the installed browser, show an explicit unsupported state. No audio or video playback is added by the preview generator.                                                                                       |

Video decoding uses an in-memory `video/mp4` Blob for both container names. The verified MOV contains the actual QuickTime `qt  ` brand; it is not a renamed MP4. Browser codec availability, worker WebGL and OffscreenCanvas remain platform requirements. Physical macOS/Windows browser coverage is a smoke-test item; the automated evidence is headless Chromium on Linux.

## Resource bounds

- One job runs at a time per active library queue in each browser tab. Requests return at most 16 pending versions. Ordinary image versions are excluded before that query limit and do not download through this queue. Several open tabs can attempt the same version; stale uploads are rejected by revision checks.
- Source downloads are streamed and checked against both the recorded exact byte count and a 50 MiB document/model or 100 MiB video cap. OBJ has an additional 16 MiB cap.
- PSD dimensions and PDF/video raster sizes are bounded to 16 million pixels. PSD dimensions must also be at most 30,000 per side, and its layer/mask section at most 16 MiB. PDF.js also receives a 16-million-pixel image limit; oversized embedded images may be omitted by PDF.js.
- GLB JSON is at most 4 MiB; node, mesh, material and image lists each contain at most 2,048 items. Accessor counts total at most one million. Embedded texture images total at most 16 million pixels; data URIs are at most 16 MiB of encoded text each. Rendered mesh index/vertex counts, including instances, total at most 750,000.
- OBJ input contains at most 250,000 declared vertices and faces, with at most 32 indices per face; the final mesh geometry also passes the rendered-count limit.
- Browser raster capture fits within 1,024 pixels per side; model frames are 512×512. A worker job has a 15-second deadline, native video decoding 10 seconds, and the full download/render/upload job 30 seconds. Queue requests and failure reports each have a 5-second timeout.
- Uploads accept at most 4 MiB of PNG bytes. The server worker verifies the PNG signature and decoded format, accepts at most 2,048 pixels per side / 4,194,304 pixels, and reencodes a metadata-stripped WebP fitting inside 512×512. Browser-provided output paths are never accepted.

Switching libraries or unmounting the queue aborts the current work. Workers are terminated; video elements, object URLs, textures, geometries, materials and WebGL contexts are released. Bounded workers isolate parsing from the main UI thread; input limits are not a promise of a fixed peak-memory bound for every malformed decoder input.

## Version identity, dimensions and cache

The server copies stable source bytes to its private immutable snapshot store before deriving the source hash and metadata. Browser jobs read only `/api/versions/:id/file`. Their upload includes the expected version ID, SHA-256 source hash, preview revision and renderer identifier. The server checks identity before and after worker processing, so replacement or cache invalidation during rendering cannot attach a stale result.

Original dimensions describe source content. Ordinary image dimensions come from image metadata; PSD dimensions come from the original PSD header. PDF, video and model dimensions remain `null` where the server has no authoritative parser. A 1920×1080 PSD keeps those dimensions after receiving a 1024×576 preview. Model raster dimensions never become source dimensions. The UI can use decoded preview dimensions for layout without persisting them.

Each successful preview or invalidation advances `previewRevision`; UI thumbnail URLs include it. Real preview responses use `private, no-cache`, and generic fallback icons use `no-store`. Neither fallback icons nor an unprocessed file count as a successful preview.

Settings → Clear thumbnails removes cached previews, retaining original files and all historical snapshots. Rebuild thumbnails reprocesses ordinary images and resets rich versions to pending, including retained history. Rich versions regenerate when their library is open in a connected Cura browser. A failed/unsupported version retains its reason and retries after a cache rebuild. Files remain downloadable when a preview is unsupported.

## API boundary

- `GET /api/libraries/:libraryId/previews` returns bounded version candidates, their format, exact source size/hash and preview revision.
- `POST /api/versions/:versionId/preview?sourceHash=…&revision=…&renderer=cura-rich-v1` accepts the PNG raster as `application/octet-stream`; stale identity returns 409.
- `PATCH /api/versions/:versionId/preview` records a validated failure code and `failed`/`unsupported` state for the same hash and revision.
- The existing version-specific thumbnail route serves the reencoded WebP. Internal snapshot and cache filesystem paths are never part of the upload contract.

Chinese and English messages distinguish size/pixel/geometry limits, unsupported encodings, external resources, unavailable WebGL/video codecs, protected PDFs, invalid files and timeouts.

## Runtime dependencies and distributed assets

Three.js and ag-psd use MIT; PDF.js uses Apache-2.0. Heavy renderers are dynamically imported only when a corresponding candidate needs a preview. The PDF parser runs as a local nested module worker. No CDN, external font service, FFmpeg runtime or Node canvas implementation is used by the browser path.

The npm PDF.js archive includes assets with their own licenses, including Liberation fonts (OFL) and an ICC profile (CC0). Cura's browser build includes PDF.js JavaScript and its worker only; those font/profile files, optional CMaps and WASM assets are not copied to the browser distribution. The workspace excludes `@napi-rs/canvas` using `ignoredOptionalDependencies`. A previously installed package can remain in an existing `node_modules`; the audit distinguishes that residue from current declared dependencies and shipped browser files.

The exact integrated build inventory, hashes, dependency-license metadata and asset checks are recorded in [browser-bundle-licenses.json](evidence/v0.2.0/browser-bundle-licenses.json). Package metadata alone does not establish the license of every optional asset: the artifact inventory and PDF asset checks are part of this evidence. This browser audit does not replace the separate server/native runtime-license check and documented mandatory Sharp native exception.

## Reproducible verification

Original fixtures and generation commands are in [e2e/fixtures/rich/README.md](../e2e/fixtures/rich/README.md) and [generate-rich-fixtures.mjs](../scripts/generate-rich-fixtures.mjs). The optional development-only `--video` command uses a system FFmpeg encoder to create synthetic H.264 bytes; Cura never distributes or invokes that executable at runtime.

[rich-media.spec.ts](../e2e/rich-media.spec.ts) decodes meaningful pixels from six real formats, checks both PSD encodings and PDF's distinct first page, blocks non-local networking, verifies archived previews after clear/rebuild, and rechecks original SHA-256 hashes. External-resource GLB and corrupt MOV tests assert explicit failure codes. Server regressions cover malformed/oversized uploads, stale identities, all retained versions, and preservation of source dimensions. Browser validation regressions reject pixel/texture/geometry bombs before rendering.
