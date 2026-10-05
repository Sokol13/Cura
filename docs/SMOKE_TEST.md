# v0.4.0 desktop smoke test

Run on physical macOS and Windows after [SETUP.md](SETUP.md), using a current Node 22 or 24 patch. Record the exact tag/commit, OS/architecture, browser and Node/pnpm versions. The core flow takes about **10 minutes after installation/build and initial scanning**. Upgrade, large PSD, performance, cloud and other optional checks take additional time. This checklist is not a claim that either platform has passed v0.4.0.

Back up an existing Cura user-data directory before upgrading. Use disposable sources for edits, locks and removal tests. Prepare two visibly different images, a Chinese filename and a nested image folder. For a larger sample, `node scripts/generate-fixtures.mjs <absolute-new-folder> 300` creates distinct PNGs with SD/Comfy metadata without overwriting files; add a Chinese filename yourself. Rich samples are in `e2e/fixtures/rich`.

The v0.4.0 changes are folder-first onboarding, dated Inbox storage and legacy migration, existing canvas assets dropped into slots, attributed slot-history comparison, explicit export dependencies, and canvas performance investigation (feedback items 10–15). The focused regression checks below retain all nine v0.3.1 fixes. [DESKTOP-FEEDBACK.md](DESKTOP-FEEDBACK.md) keeps the complete numbered request.

## Core flow — about ten minutes

Install and start beforehand: `pnpm install --frozen-lockfile`, then `pnpm start` (`pnpm.cmd` on Windows). The default browser should open and `/api/health` should return `{"status":"ok"}` without an account. Stop at a failing step and record it; do not rush through missing results to fit the time estimate.

| Time     | Action                                                                                                                                                                | Expected result                                                                                                                                                                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–1 min  | Create an empty library. Use the primary **Register local folder / 登记本机文件夹** action.                                                                           | The adjacent **Import files / 导入文件** action is secondary. The explanation says registered originals stay in place; their names and bytes remain unchanged.                                                                                            |
| 1–2 min  | Register the nested sample, inspect its completed scan summary, then add one new distinct image.                                                                      | Nested images appear recursively. Supported/skipped/error counts are understandable. The new completed file appears within five seconds without refresh; record actual elapsed time.                                                                      |
| 2–3 min  | In another empty test library, use **Import files** to upload a Chinese-named image. Inspect the source location, then import different bytes with the same filename. | Sources use `Inbox/YYYY-MM-DD/filename.ext`, with the computer's local date. Only the colliding filename receives a short suffix; both byte sequences remain available.                                                                                   |
| 3–4 min  | Return to the registered library. Inspect SD/Comfy prompt/model text, search a Chinese name or prompt, combine a filter, and scroll grid/list.                        | Text is readable and results match. The interface stays responsive; a manual impression does not certify the automated 200-ms query gate.                                                                                                                 |
| 4–5 min  | Annotate an image, replace it with visibly different V2, and compare asset V1/V2. Try Trash/restore and switch language/theme.                                        | Retained bytes, version-specific annotations and preferences survive. Trash is recoverable and leaves originals on disk untouched.                                                                                                                        |
| 5–7 min  | On a board, add a free asset pinned to V1, then replace that asset with V2. Drag the existing free V1 item onto a slot, and assign a different pin to that slot.      | The slot receives the exact displayed V1, not current V2. Its free source item stays at its old position with its connections. The next assignment creates one slot revision.                                                                             |
| 7–8 min  | Open slot history and choose two revisions with the left/right selectors; switch language and reopen the dialog.                                                      | Both historical images, source names, asset-version numbers, actor and time remain correct. Changing the comparison does not assign a pin or create history.                                                                                              |
| 8–9 min  | Select assets and open neutral export. Read the selected/dependency counts and reasons before confirming; download the ZIP.                                           | The confirmation states all included assets. `manifest.json` contains those unique asset IDs and retained versions; ZIP entry count may differ because versions and metadata add files.                                                                   |
| 9–10 min | Disconnect networking, reload/search/preview/reopen the board, export diagnostics, then restart Cura.                                                                 | Local work and saved history remain usable without an account. Unconfigured cloud says Local mode; an unavailable configured cloud does not prevent local startup. Diagnostics include scans, warning/error logs, media queue state and SQLite integrity. |

## Focused v0.4.0 follow-up

### Dated Inbox and released-data upgrade

Use a backup of disposable data created by released v0.3.1. Keep the backup untouched and note the original source paths, hashes, asset/version IDs and current versions before starting the new runtime. The [upgrade verifier](evidence/v0.4.0/inbox-upgrade.md) documents the generated Linux baseline and exact automated invariants.

- Include Chinese/NFD names, same-name/different-content uploads, deduplicated aliases, Trash, and a V1 source whose current asset was manually replaced by a differently named V2. Keep one ordinary registered reference folder as a control.
- After startup, existing UUID Inbox sources should move to dates derived from their original source creation time in the computer's local timezone. Their stored basename comes from the original source, not the manual V2 name or a later display name. Only collisions gain a suffix. Manual current V2, all versions, hashes, authored metadata and historical previews/downloads must remain unchanged; reference-folder files must not move.
- Search the new relative paths and aliases. The moved UUID locator should no longer match. Restart again: locators, version counts and hashes should stay the same.
- Include one source already missing before upgrade. It must remain unavailable at its old locator, with retained history still downloadable; migration must not recreate the missing original from its snapshot.
- On Windows, separately try a real exclusive lock that prevents migration. A recoverable warning must preserve bytes/history; release the lock and restart to retry. Keep any warning/diagnostic result. An open editor does not necessarily hold an exclusive file lock.

### Canvas pins and slot comparison

- Repeat a tray-to-slot drop and an existing-canvas-to-slot drop. Check a grouped item at a different zoom level, and reload to verify the exact pin, original free-item position and connections. A drop outside a slot should remain ordinary movement.
- Build slot history **A/V1 → B/V2 → A/V1**. Select the first and third revisions: distinct slot revisions may legitimately show the same asset/version. Keep **slot version** and **asset version** numbers distinct.
- Later replace/rename the assets and move them to Trash. Reopen the history: source names must still come from the pinned historical versions, and each original download must contain those historical bytes. Comparison alone must not change board history.
- Use the selectors and download links with the keyboard in English and Chinese; check a narrow window. Empty/single history should explain the next step; cleared revisions have no original, and unsupported previews offer the pinned original instead of a misleading image.
- Legacy revisions show **Not recorded / 未记录** for actor. A new action shows **Local user / 本机用户** when no currently verified, unexpired account is available; a verified account is recorded when present. Disconnecting networking alone does not necessarily change that state. Do not infer an old author from the current session or OS username.

### Exact export dependency confirmation

In a separate disposable library with no other references, select assets A/B and put free assets C/D on a board. The confirmation should state **2 selected + 2 board-referenced assets**; its manifest should contain exactly A/B/C/D. Cancel once and confirm no export job was created. Try Chinese and English. If dependencies have overlapping reasons, each asset counts once even when it appears in several reason categories.

For stale confirmation, leave that preview open. In another window, replace the free board item referencing C with F, keeping the dependency count the same. Confirm the old preview: it must refresh and require another explicit confirmation before a job starts. The final ZIP must contain A/B/D/F. Use free board items here: retained slot history intentionally keeps old dependencies. A new version of the **same** asset with unchanged membership/reasons does not invalidate this asset-count preview; the token does not freeze version bytes.

### Windows canvas responsiveness and CDP captures

First revisit the actual board that previously timed out on Windows. Record OS/browser version, GPU, display scaling/refresh rate and board size. Keep the window foreground and previews settled; check ordinary pan/zoom/selection separately from automation. If the freeze returns, retain the timeout and diagnostic evidence.

The reproducible generated-board follow-up is in `e2e/canvas-performance.spec.ts`. After the Playwright browser setup in [SETUP.md](SETUP.md), run in PowerShell with other CPU-heavy work stopped:

```powershell
pnpm.cmd build
pnpm.cmd exec playwright test e2e/canvas-performance.spec.ts --project=chromium --workers=1 --retries=0 --headed
```

Keep the test browser visible and untouched. The four cases cover a 100-node canvas, that canvas with slot comparison open, a filled 10×10 matrix, and a controlled DPR 1.25 canvas. Each settles, measures 15 seconds of idle `requestAnimationFrame` intervals and Long Tasks, then takes ten sequential viewport CDP screenshots with a three-second deadline per capture. Idle and screenshot-load measurements are separate; the idle gates are p95 <34 ms, maximum <100 ms and no Long Task ≥100 ms. Preserve the Playwright JSON artifacts and first/last captures, including failures. See [TESTING.md](TESTING.md) for source-bound results and measurement details.

Controlled DPR 1.25 is browser emulation, not a reproduction of native Windows display scaling. Linux headless measurements and a responsive manual session do not establish that the reported physical Windows freeze is fixed. Only a run on the affected machine/board can resolve that boundary.

## v0.3.1 desktop regression checks — items 1–9

1. **Actual large PSDs:** register the three original Photoshop files reported at 3866×6871 through 13391×7032. Each needs meaningful pixels in under 10 seconds and peak service-process memory below **500 MB**, including worker/native memory. Record each file's dimensions, elapsed time and observed peak using Activity Monitor/Task Manager; record sampling limitations. Verify retained versions after a preview rebuild. Generated Linux files, including the 8192×8192 proxy for the unknown middle size, do not establish results for these three actual files.
2. **Folder removal:** on a disposable registered folder, default **Also move these assets to Trash** should remove orphaned assets from the normal catalog and permit restore. **Only stop watching** should keep history and mark offline sources. Filter **Source unavailable** for batch actions. Originals remain untouched; another online alias keeps the asset available. Cura Trash is logical, so this action does not itself test OS recycle-bin moves or locked-file relocation.
3. **Scan transparency:** register an empty folder and one with nested images plus unsupported files. Completion must not stay at “scanning 0/0.” Expand extension/error details; symlinks are skipped. Repeat the Windows Downloads folder that previously returned zero and retain its summary.
4. **Diagnostics:** after an actual scan, metadata or thumbnail warning, inspect the exported ZIP for each root's latest scan summary, up to 200 recent warn-or-higher records, thumbnail queue state and SQLite integrity results. `logs.json` can be empty when no warnings occurred. Source paths should be redacted.
5. **Template localization:** check all four built-in templates' names, slot labels and purposes in Chinese and English, including existing boards. Custom/renamed labels must remain exact; changing language must not save translated labels into the board.
6. **Shortcuts:** hints show **⌘ F** on Mac and **Ctrl F** on Windows/Linux. Check focus behavior and that typing in editable fields is not intercepted.
7. **Preview explanations:** at a narrow inspector, unsupported/oversized messages wrap across the width below the icon. A normal preview still opens.
8. **Node 24 clean start:** use a fresh clone and frozen install; SQLite/Sharp should install as prebuilts without local compilation. Normal start opens the default browser. `pnpm test` also works without the ignored optional FCPXML DTD cache: exactly its three grammar-dependent cases skip with one preparation hint; CI prepares the cache and runs them.
9. **PNG text:** inspect UTF-8 Chinese tEXt SD/Comfy images and a Latin-1 sample. Prompt/model text remains readable; existing compressed/international text metadata still works.

## Additional P1/P2 and platform checks

These extend the core flow; they are not part of its ten-minute estimate.

- **Organization/process:** set a readable display name, archive a non-final asset, find it in Archived and restore it. Physical filenames stay unchanged; Archive and Trash remain distinct. Historical final-owned assets cannot be archived, and assigning a final pin restores an archived asset. Inspect prompt history/statistics; run and cancel the clearly labelled local mock, preserving completed outputs.
- **Boards/brands/CMF:** create/fill a matrix cell, add text/group/connection and reload. Add a color, pinned logo, guideline and CMF entry; export HTML/PDF/JSON/ASE and open the downloaded files offline. Chinese labels, colors and logos should render; PDF pages are rasterized and JSON remains editable.
- **Rich previews:** import model/PSD/PDF/video samples. Expect meaningful pixels or explicit format/codec/resource limitations. Check first-frame video and portrait JPEG orientation. Password-protected PDF and external model resources must not silently show success. [Preview limits](PREVIEWS.md).
- **Automation/documents:** analyze one image with Metadata rules, review/apply a tag/name proposal and selectively undo it. Originals remain intact. Import the UTF-8 script below, generate a setting document, edit and download Markdown/JSON. Entities must link to retained source lines, and saved document provenance survives later asset edits.
- **Live changes/navigation:** with preview open, replace/rename/remove only a disposable registered source. Current bytes refresh while history stays available; stale Creative process selection cannot finalize an unseen replacement. Check Back/Forward between workspaces and Escape from dialogs. Cache rebuild must not alter dimensions, history or cloud-authored metadata.
- **macOS permissions/names:** protected-folder denial should name Full Disk Access for terminal/Node; grant it and retry. Check physical NFC/NFD filenames when possible.
- **Windows paths/locks/watch:** register a Chinese-named directory and a long nested path. Measure completion-to-appearance latency for a new file. Try an actually unreadable/locked source: errors must be recoverable and retained history preserved. A lock may allow reads; report its exact effect rather than assuming every open file is blocked. PowerShell `.cmd` commands must remain usable.
- **Neutral export:** also export the whole library and inspect its readable manifest/CSV, all retained versions, boards and metadata. Missing/corrupt bytes must not report success. Limits are 3.5 GB including metadata and 65,532 payload files; oversized requests fail visibly.

```text
INT. WORKSHOP - DAY
@LIN
We need the lantern.
PROP: LANTERN
SCENE: WORKSHOP
```

### FCPXML and Final Cut Pro

Add two PNG/JPEG versions to a timeline, change order/duration, download its media ZIP and reopen history. Extract the ZIP, run `node relink.mjs` inside it, move the whole folder and run it again. On a Mac with Final Cut Pro, import `timeline.fcpxml` and check order, duration, readable labels and exact historical imagery, including a portrait JPEG with EXIF orientation. Use spaces and non-ASCII media paths. Linux DTD/hash checks do not establish Final Cut Pro application behavior.

For supported MP4/MOV, use **Inspect video source**, then set an in-point in source frames and duration in project frames. Unsupported timing/codecs must give per-clip guidance instead of a misleading successful package. Limits are 1,000 clips and 3.4 GB of distinct media. [FCPXML limits](FCPXML.md).

### Optional configured cloud/model check

Local use requires neither service. Follow [Cloud & team](CLOUD-WORKSPACE.md) and [Supabase setup](../supabase/README.md) with disposable data and two updated Cura instances. Newly attributed slot records require updated participating sync clients; older schemas reject the actor field. Keep credentials out of screenshots and shared diagnostics.

1. Sign in, publish a test library, add another account as editor and join/open it on the second computer. Verify retained versions and rebuilt thumbnails. Local source-folder registrations must not appear on the other device.
2. Edit metadata on both devices, reconnect and sync. Local-wins conflicts must retain both snapshots. Pause/resume and restart while disconnected; local work stays usable. Verify new account-attributed slot history retains the original actor after sync/restart; legacy revisions remain **Not recorded**.
3. Change the second account to viewer: cloud publishing stops while local edits remain. Remove membership and verify cloud access is rejected. Signing out on one device must not sign out the other.
4. Confirm passwords/tokens are absent from browser storage and neutral exports. Check physical Windows session-file access is restricted to the user's account. Historical actor ID/email is intentional provenance, not a credential.
5. For a configured vision endpoint, explicitly select its provider, review actual caption/structured provenance, apply/undo and test cancellation/failure. Small-model output still needs review. [Provider configuration and measured limits](AUTOMATION.md).

## Existing physical evidence and result reporting

At **main `6ed394b`**, the user reported passes on both Mac and Windows for library creation, folder registration (17/17 each), Chinese uploads, SD/Comfy Chinese metadata, filename/prompt search, character-slot V1→V2/history, neutral ZIP dependency closure and diagnostic export. Mac also registered 152 Desktop files. These are historical results, **not v0.4.0 physical passes**. See [DESKTOP-FEEDBACK.md](DESKTOP-FEEDBACK.md).

Still requiring reported physical results: Windows Chinese registered paths, occupied-file behavior and measured watcher latency; the three actual Mac PSDs after the decoder change; and the Windows canvas/CDP freeze. The PSD files previously failed and the Windows freeze has not been reproduced on the affected machine here. Do not mark these passed from generated Linux tests, simulated platforms or controlled DPR measurements.

Report pass/fail and the first failing step, exact tag/commit, OS/architecture, browser, Node/pnpm versions, expected versus actual behavior and terminal output. For a PSD include dimensions/time/peak-memory method; for canvas include idle versus capture measurements, display/GPU details and artifacts. Add screenshots and a diagnostic ZIP when useful. Startup failures need the terminal error and relevant [SETUP.md](SETUP.md) logs. Inspect artifacts for private filenames/metadata before sharing; never include credentials.

Linux Chromium, local Supabase and official FCPXML DTD validation do not substitute for physical Mac/Windows, hosted deployment or Final Cut Pro checks. Incoming desktop failures take priority over new work.
