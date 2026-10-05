# Desktop feedback and follow-up acceptance

## User-reported physical results at main 6ed394b

Both macOS and Windows passed library creation, registered-folder ingestion (17/17 on each), uploads with Chinese filenames, SD WebUI and ComfyUI metadata including Chinese prompts, filename/prompt search, character-template V1 assignment → V2 replacement → slot history, neutral ZIP export with dependency closure, and diagnostic export. macOS also registered 152 files from `~/Desktop`.

Still untested by the user: Windows directory paths containing Chinese characters, trash operations while files are locked, and watcher latency. These results are reported by the user, not independently repeated in this Linux container. Three large PSDs on macOS failed preview with a size-limit message; reported dimensions range from 3866×6871 to 13391×7032. Their actual files and third dimensions were not supplied.

## Delivery rules

Implement the numbered items in order. Each completed item must be validated, documented in PROGRESS.md and pushed to main. Finish items 1–9 and publish v0.3.1 before implementing items 10–15. Finish the latter group and publish v0.4.0. No questions; record decisions in DECISIONS.md. Incoming desktop defects retain priority. The user's explicit newer release scope and Node range supersede the original completed milestones and Node-22-only wording; do not stop at v0.3.0.

## v0.3.1 — required fixes

1. PSD preview: try image resources 1036/1033 first, then merged image data without parsing the layer tree; only then use existing fallback limits. Representative PSDs covering the reported dimensions must produce thumbnails in under 10 seconds with peak process memory below 500 MB. Preserve original bytes, dimensions and versions; report fixture-based versus actual-file verification honestly.
2. Folder removal: confirmation offers “仅停止监听（保留历史版本，资产标记为离线）” and “同时移除这些资产（进回收站，可恢复）”, defaulting to trash. Clarify that source files are untouched. Add a “源文件不可用” filter for batch cleanup.
3. Scan transparency: after every registered-folder scan show supported count, unsupported skipped count and read-error status. Expand/hover reveals extension totals and error details. Confirm recursive subdirectory traversal and document it. A completed empty/error scan must not remain “正在扫描 0 / 0”.
4. Useful diagnostics: include latest scan summary for each directory, most recent 200 warn-or-higher records, thumbnail queue state and database integrity results. Include scan/metadata/thumbnail failures, not only HTTP traffic.
5. Localize every built-in template's slot labels and descriptions into zh-CN. Preserve user-authored names.
6. Use one shared platform-aware shortcut formatter throughout the UI: Ctrl F on Windows/Linux, ⌘ F on macOS.
7. Preview-limit/error text occupies a full line beneath the generic icon, not a narrow strip to its right.
8. Broaden Node engines from `>=22 <23` to `>=22 <25`; CI must run the full suite on Node 22 and 24. Repair incompatible dependencies rather than rejecting Node 24. Keep native prebuilts and documented license constraints.
9. PNG tEXt values: decode valid UTF-8 first; fall back to Latin-1 only if UTF-8 decoding fails.

## v0.4.0 — experience improvements

10. Empty-library onboarding: two parallel entry points, “登记本机文件夹” primary with an explanation that originals stay in place, “导入文件” secondary.
11. Inbox uploads use `Inbox/YYYY-MM-DD/original-name.ext`, adding a short suffix only on collision. Migrate existing UUID subdirectories without changing content hashes or version records; preserve source identities and recover safely from interruption/locked files.
12. Existing free canvas assets can be dragged into slots and finalized, just like assets from the tray.
13. Slot history supports side-by-side comparison of two selected revisions, with originating assets and replacement actor/time. Missing historical actor data must be identified as unknown rather than fabricated.
14. Before export show exact selected and dependency asset counts and reasons, e.g. “导出 2 个选定资产 + 2 个被看板引用的资产”. Compute closure from the same source as the resulting ZIP.
15. Investigate Windows canvas freezing: eliminate unnecessary continuous redraw/polling or unthrottled listeners, measure idle frame times with Performance API and repeated CDP screenshots, and record results/limits in TESTING.md.

The final REPORT-v0.4.0.md must enumerate all 15 items, how each was verified, released commits/CI, and the checks requiring physical machines or actual user files. v0.3.1 also receives its own report and refreshed smoke checklist before its tag.
