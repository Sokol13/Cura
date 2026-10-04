# Brand kits and CMF boards

Open a library, then choose **Brands & CMF** (**品牌与CMF**). These workflows use the local catalog and do not require an account or network connection. Registered originals are never modified by brand or CMF edits.

## Build a brand kit

1. Choose **New brand**, enter a name, and create it. Select existing kits from the left sidebar.
2. Add named palette colors. Enter HEX, comma-separated integer RGB channels (0–255), or comma-separated CMYK percentages (0–100). Colors can be renamed, reordered and removed.
3. Choose **Register font**. Search existing assets or use **Import font or sample** to upload a font, then choose the asset and exact version. Name the font and describe its role. Browser font support varies; registration and original-file export remain available even when a font cannot render.
4. Add logo variants such as horizontal, vertical and monochrome. Each variant selects an existing asset version. Its retained preview and original-file download remain available independently of later replacements.
5. Write usage guidelines and expand **Guidelines preview**. The supported Markdown subset includes headings, bold text, inline code and single-line bullet lists. Raw HTML and remote-image syntax appear as text; they cannot run scripts or fetch outside resources. Links remain text.
6. Choose **Save kit** before exporting. The export buttons stay disabled while unsaved brand edits exist. Deleting a kit or removing one of its references leaves the underlying assets and versions intact.

Brand and CMF saves use revisions. If another window has saved the same record, the older edit is rejected instead of silently overwriting the newer one. Copy any unsaved text you need, then use **Reload** before editing again.

## Exact version references

Fonts, logo variants and CMF samples store both an asset ID and a version ID. The picker lists retained versions explicitly. Replacing or externally updating an asset creates its next version while existing brand/CMF references continue showing the chosen earlier version. **Choose another version** changes that reference deliberately; it does not rewrite either version's file bytes.

Saved kits, ordered items, colors, guidelines, roles and process notes survive reload/restart. In this implementation, the workspace initially selects the first brand and the Brand kits tab; reopen the CMF tab or select another saved record as needed. The library-level navigation integration may preserve additional view state.

## Color interpretation

HEX is the canonical stored color, normalized to lowercase. RGB is derived exactly from its three bytes. CMYK is a deterministic **unprofiled approximation** of sRGB, not an ICC-managed print specification; pure black is represented as `0, 0, 0, 100`. Entering CMYK converts it to the canonical RGB/HEX value, so later displayed CMYK may differ slightly through rounding or the removal of redundant black/color contributions.

Use an appropriate print-production/color-management workflow when exact printed output matters. Cura preserves the named values and their representations without claiming a printer profile or spot-ink match.

## Four brand deliverables

All exports use the last saved kit and exact pinned files. They have no dependency on a running Cura instance to read their embedded content.

| Format   | Contents and behavior                                                                                                                                                                                                                                                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HTML** | One UTF-8 document with the brand name, palette values, typography samples, raster logo previews and safely rendered guidelines. Original font and logo bytes are embedded as download links; user-registered fonts are embedded with `@font-face`. No remote fonts, scripts or image URLs are needed. Unsupported fonts fall back for display while their original bytes remain included.        |
| **PDF**  | An A4 brand page document containing the palette, font samples, logos and guidelines. The browser renders Chinese/system/user fonts into paginated JPEG pages, which are embedded in a standards-based PDF. **Text is rasterized and is not searchable/selectable.** Use HTML or JSON for editable text. An unsupported font is identified in the document and its original remains in HTML/JSON. |
| **JSON** | Readable `cura-brand` schema version 1 with the entire saved brand, ordered colors/fonts/logos, timestamps, exact pins, HEX/RGB/CMYK values and guidelines. The `files` array includes original names, media types, SHA-256 hashes and base64 file bytes, plus available raster preview data. It contains no private internal snapshot/cache paths.                                               |
| **ASE**  | An Adobe Swatch Exchange RGB palette with named Unicode colors and normalized float channels. ASE contains colors; it is not a font container. Fonts and full color representations remain in JSON/HTML.                                                                                                                                                                                          |

The embedded package is limited to **64 MiB of original pinned files**. Larger source sets should use neutral library export. HTML/PDF require a retained raster preview for each logo: if a preview is missing after cache clearing, rebuild thumbnails from library Settings and retry. JSON still retains original file bytes, and ASE remains the palette format.

PDF generation is bounded to 32 pages, 1,000 layout blocks, 500,000 text characters and 64 MiB of encoded JPEG pages. Each embedded preview must be at most 16 MiB and 20 million decoded pixels. Long guidelines wrap and paginate; oversized documents fail instead of being silently truncated. Reduce the document or export HTML/JSON when a PDF limit is reached. PDF generation uses browser Canvas and a small local PDF writer; no external converter or bundled font is installed.

## CMF workflow

Switch to **CMF boards**, create a named board, and choose **Add material sample**. Pick an exact asset version, then enter the material name, color name/value, and manufacturing/process notes. Add more samples, move them up/down, edit them, or remove references. Choose **Save CMF board** and reopen the saved board to verify the order and notes.

CMF references retain the chosen asset versions just like brand references. Deleting a CMF board does not delete original samples. Brand deliverable buttons apply to brand kits; complete CMF records and pinned dependencies are exposed to neutral library export through the domain reader.

## Local API and export boundary

All bodies and responses use shared Zod contracts. `PUT` replaces an ordered aggregate atomically and requires `expectedRevision`; omitted/deleted child rows remove references only. Cross-library pins, mismatched asset/version pairs, duplicate child IDs and child IDs belonging to another kit/board are rejected.

| Endpoint                                         | Purpose                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `GET, POST /api/libraries/:libraryId/brands`     | List/create kits.                                                                                                                    |
| `GET, PUT, DELETE /api/brands/:id`               | Read/save/delete a kit and its ordered children.                                                                                     |
| `GET /api/brands/:id/package`                    | Read a bounded portable package, verifying retained file hashes. The browser creates HTML/PDF/JSON/ASE downloads from this snapshot. |
| `GET, POST /api/libraries/:libraryId/cmf-boards` | List/create CMF boards.                                                                                                              |
| `GET, PUT, DELETE /api/cmf-boards/:id`           | Read/save/delete a CMF board and ordered entries.                                                                                    |

`readBrandExport(database, libraryId)` returns typed `{ brands, cmfBoards, pins }`, including child order, timestamps and deduplicated exact-version dependencies. Neutral export must include the referenced version bytes when it includes these records; it must not treat current asset versions as replacements for their pins.

## Verification and desktop smoke boundary

The real-server Linux Chromium E2E created a Chinese brand, converted RGB/CMYK colors, imported a real self-authored test TTF, selected two logo variants, saved malicious/long Markdown as safe text, replaced a logo asset, and downloaded all four formats. It also edited/reordered/reopened/deleted CMF records, updated/removed brand children, deleted the kit, and verified Chinese/light UI and unchanged source bytes.

The downloaded JSON preserved exact original font/logo bytes and historical pins. An independent ASE decoder checked block lengths, Unicode names, channel values and the end of the file. PDF.js independently parsed and rendered **six PDF pages**, finding meaningful text pixels on every page and the expected orange/blue content. The downloaded HTML's exact bytes rendered in a fresh isolated browser document: both logo images decoded, the embedded font loaded, Chinese guidelines remained present and no injected script ran. Browser HTTP/WebSocket interception recorded no external requests. See [measured evidence](evidence/v0.2.0/brand-exports.json).

The managed test Chromium blocks top-level `file:` and `data:` navigation with `ERR_BLOCKED_BY_ADMINISTRATOR`. Therefore the HTML check loads the exact downloaded bytes using `setContent`, with all network requests blocked. It proves content rendering and self-containment, **not physical desktop file association/opening**. PDF validation uses an independent PDF.js parser/renderer rather than only a file signature. Unit tests additionally check SQLite isolation/revisions, ordered persistence, version pins, snapshot integrity, Markdown safety, ASE structure, PDF cross-reference offsets, pagination and resource bounds.

On macOS and Windows, extend the milestone smoke test with these steps:

1. Create a small kit using a local font and two logo versions; save it and download HTML/PDF/JSON/ASE.
2. Disconnect networking and double-click HTML in the default browser. Check Chinese text, embedded font and both logo variants; download an embedded original and compare it with the source.
3. Open PDF in the normal desktop reader, check every page and confirm long guidelines continue without clipping. Rasterized text is expected.
4. Import ASE into a compatible palette tool and inspect JSON's color/font definitions. Replace a source asset in Cura and confirm the saved kit still uses its pinned version.
5. Reopen a CMF board and check sample order, colors and process notes.

These physical desktop checks remain unverified until actual smoke results are recorded. No account or credentials are required.
