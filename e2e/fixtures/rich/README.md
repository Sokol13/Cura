# Original rich-preview fixtures

Run `node scripts/generate-rich-fixtures.mjs e2e/fixtures/rich` to reproduce the original models, PSDs and PDF. Pass `--video` to regenerate the two small videos using a development machine's `ffmpeg` command. Cura does not install or invoke FFmpeg at runtime. The committed H.264 bytes were generated with the command recorded verbatim in that script, using two synthetic color frames and no audio or third-party artwork. Encoder versions can change compressed bytes; the scenes, timestamps and acceptance pixels are deterministic.

- GLB: glTF 2 binary cube, local binary geometry, red material; OBJ: equivalent cube without external material files.
- PSD: 64×48 RGB8 merged composites with four known color quadrants; separate raw and PackBits encoding, valid empty layer sections.
- PDF: valid xref/page tree with a red first page and blue second page. No external fonts or resources.
- MP4 and MOV: actual H.264 containers, red first frame then blue second frame. MOV has QuickTime `qt  ` brand, not a renamed MP4.
- External-resource GLB: deliberate rejected network buffer reference. No request may leave the local server.

Runtime readers are pinned Three.js 0.180.0 (MIT), ag-psd 14.3.1 (MIT, only MIT base64 dependencies), and PDF.js 5.4.296 (Apache-2.0). The browser bundle includes PDF.js code/worker only, no bundled Liberation OFL fonts or CC0 ICC profiles. Font substitution and optional CMap/JPEG2000/color-profile features are limited by the bundled configuration and browser; no document scripts execute.

Preview limits: one browser job at a time, 16 candidates per request, 50 MiB documents/models or 100 MiB video; 16 million source pixels, at most 1024px raster capture (512px cached WebP), 4 MiB PNG upload. Worker rendering has a 15-second deadline, native video 10 seconds, and an entire job 30 seconds. Models reject external resources, required compression extensions and excessive geometry/textures. PSD supports tested RGB8 raw/RLE merged composites. Video codec support follows the installed browser: H.264 MP4/MOV are verified in Chromium; ProRes/HEVC and other unavailable codecs receive an explicit unsupported state.

Source dimensions are never inferred from uploaded preview pixels. PSD dimensions come from its immutable source header; document/video/model dimensions remain null when the server has no authoritative parser. Display layout may use the decoded preview's natural dimensions without writing them into catalog metadata.

All originals and historical snapshots remain immutable. Cache clearing/rebuilding resets rich versions for regeneration while a Cura browser has that library open. Unsupported/failed items retry after a cache rebuild; a generic icon is never treated as successful generation.
