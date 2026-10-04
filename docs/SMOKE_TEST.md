# v0.3.0 desktop smoke test

Run on physical macOS and Windows after [SETUP.md](SETUP.md). Allow about **10 minutes after installation/build**; an initial scan and optional cloud setup take longer. This is a manual checklist, not a claim that either platform has passed. Record the exact tag/commit, OS and architecture. Earlier evidence remains in the [v0.1](REPORT-v0.1.0.md) and [v0.2](REPORT-v0.2.0.md) reports.

Prepare a disposable folder with 200–500 images and a Chinese filename. `node scripts/generate-fixtures.mjs <absolute-new-folder> 300` generates PNGs with SD/Comfy metadata without overwriting files. Keep two visibly different files for replacement. The original rich fixtures are in `e2e/fixtures/rich`. Back up an existing Cura user-data directory before upgrading; external edits in this checklist apply only to disposable sources.

| Time     | Action                                                                                                                                                                                                   | Expected result                                                                                                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–1 min  | Run `pnpm install`, then `pnpm start` (`pnpm.cmd` on Windows). Create a library or reopen the prior test library.                                                                                        | Builds, opens the default browser and serves `/api/health` as `{"status":"ok"}`. No account required. Earlier versions, tags, boards and annotations survive upgrade.                        |
| 1–2 min  | Register the image directory. Add a new distinct image and drag another into Cura. Inspect an SD/Comfy image.                                                                                            | Originals retain their names/bytes; thumbnails and embedded prompt/model appear. New completed files appear within five seconds without refresh.                                             |
| 2–3 min  | Search a Chinese name/note, combine filters, switch grid/list and scroll. Set a readable display name, archive a non-final asset, find it in Archived and restore it.                                    | Search/filters match, scrolling remains responsive. The physical filename stays unchanged. Archive and Trash remain distinct. Human timing does not certify the automated 200-ms gate.       |
| 3–4 min  | Edit an annotation and prompt; replace the asset and compare V1/V2. Try Trash/restore and switch language/theme.                                                                                         | Historical bytes, corrected metadata and annotations remain available; preferences and restores persist.                                                                                     |
| 4–5 min  | Open Boards, fill a character slot, replace its pin, inspect history and create/fill a matrix cell. Add text/group/connection and reload.                                                                | Exact pins/history and layout return. Archive cannot hide a final-owned asset, including a historical pin. Assigning a final pin restores an archived asset.                                 |
| 5–6 min  | Open Brands & CMF; add a color, pinned logo, guideline and CMF entry. Export HTML/PDF/JSON/ASE.                                                                                                          | Values/pins survive reload; downloaded HTML/PDF show Chinese text, colors and logo offline. PDF text is rasterized; JSON remains editable.                                                   |
| 6–7 min  | Import rich fixtures and inspect model/PSD/PDF/video previews. In Creative process, inspect history/statistics and run/cancel the labeled mock.                                                          | Meaningful pixels appear, or an explicit supported-format/codec limitation. The mock produces a real image; cancellation preserves completed outputs.                                        |
| 7–8 min  | In Automation & documents, analyze one image with Metadata rules, apply a tag/name proposal and undo it. Import the small script below; generate a setting document, edit it and download Markdown/JSON. | Rules are clearly labelled, changes are reviewable/reversible and originals stay intact. Entities point to retained lines; saved document provenance survives later asset edits.             |
| 8–9 min  | In FCPXML timeline add two PNG/JPEG versions, change order/duration, then download the media ZIP. Also export a selected asset and the whole library.                                                    | FCPXML history reopens; archives contain readable manifests and retained bytes. Selected neutral export may include documented dependencies. No missing/corrupt-byte export reports success. |
| 9–10 min | Disconnect networking, reload/search/preview/reopen a board and Cloud & team. Rebuild thumbnails, export diagnostics and restart Cura.                                                                   | Local work remains available with no account. Unconfigured cloud shows Local mode. Saved state/history survive; unavailable configured cloud does not prevent local startup.                 |

Use this UTF-8 `.fountain` script for the retained-reference check:

```text
INT. WORKSHOP - DAY
@LIN
We need the lantern.
PROP: LANTERN
SCENE: WORKSHOP
```

## FCPXML and platform follow-up

- Extract the FCPXML ZIP, run `node relink.mjs` inside it, move the whole folder and run it again. On a Mac with Final Cut Pro, import `timeline.fcpxml` and check order, duration, readable labels and exact historical imagery. Try a portrait JPEG with EXIF orientation. Linux grammar/hash checks do not establish actual Final Cut Pro behavior.
- For supported MP4/MOV, use **Inspect video source**, then set an in-point in source frames and duration in project frames. Unsupported timing/codecs must give per-clip guidance; they must not generate a misleading successful package. [FCPXML limits](FCPXML.md).
- **macOS:** Protected-folder denial should name Full Disk Access for the terminal/Node. Grant it and retry. Check NFC/NFD Chinese filenames where possible.
- **Windows:** Try a long nested path and a locked/unreadable file. Expect a recoverable error, preserved state and usable PowerShell `.cmd` commands. Extract non-ASCII filenames and relocate FCPXML media with spaces/non-ASCII path components.
- While preview is open, replace/rename/remove its disposable registered source. Current bytes refresh; historical bytes stay available. A stale Creative process display must not finalize an unseen replacement.
- Check Back/Forward between workspaces and Escape from dialogs. Preview/cache rebuild should not alter source dimensions, history or cloud-authored metadata.
- Open downloaded brand HTML/PDF as actual desktop files. Password-protected PDFs, unsupported video codecs and external model resources should report limitations. [Preview limits](PREVIEWS.md).
- Neutral ZIP limits are 3.5 GB including metadata and 65,532 payload files; FCPXML packages allow 1,000 clips and 3.4 GB of distinct media. Oversized requests fail visibly; use smaller selections.

## Optional configured cloud/model check

This takes additional time and is not required for local use. Follow [Cloud & team](CLOUD-WORKSPACE.md) and [Supabase setup](../supabase/README.md) using a disposable project/library and two Cura instances. Keep credentials out of screenshots and shared diagnostics.

1. Sign in, publish a test library, add another account as editor and join/open it on the second computer. Verify exact retained versions and locally rebuilt thumbnails. Source-folder registrations must not appear on the other device.
2. Edit metadata on each device, reconnect and run sync. Verify local-wins conflicts retain both snapshots. Pause/resume; restart while disconnected and confirm local work remains usable.
3. Change the second account to viewer: cloud publishing must stop while local edits remain. Remove membership and verify cloud access is rejected. Signing out on one device must not sign out the other.
4. Confirm passwords/tokens are absent from browser storage and neutral exports. User-data session-file access on physical Windows should be restricted to the user's account.
5. For a configured vision endpoint, explicitly select its provider, review actual caption/structured provenance, apply/undo and test cancellation/failure. Do not expect small-model captions or structured extraction to be accurate without review. [Provider configuration and measured limits](AUTOMATION.md).

## Report a result

Record pass/fail and the first failing step, tag/commit, OS/architecture, Node/pnpm versions, expected versus actual behavior and terminal output. Include a screenshot and diagnostic ZIP when useful. For startup failures include the terminal error and relevant logs from SETUP.md. Inspect logs for private filenames/metadata before sharing; never include credentials.

Desktop results and limits go into the milestone report. Linux headless Chromium, simulated Windows naming/paths, local Supabase and official FCPXML DTD checks do not substitute for physical Mac/Windows, hosted deployment or Final Cut Pro application checks. Incoming desktop failures take priority over other work.
