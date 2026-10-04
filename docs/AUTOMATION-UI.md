# Automation and setting documents

Open a library and choose **Automation & documents** (自动化与设定文档). The four sections work with the local service. English and Simplified Chinese follow the library application's language setting; light and dark themes use the same application theme.

## Review automation

Choose assets from the searchable, paginated picker, then choose an analysis provider. **Offline metadata rules** works without an account or network. It derives suggestions from existing names and declared metadata; it does not inspect image content. Configured visual providers appear separately and identify structured-output or caption-derived results. Provider endpoints and credentials remain server-side; see [AUTOMATION.md](AUTOMATION.md) for configuration.

Analysis creates persistent jobs and reviewable proposals. Choose an analysis-history entry to see its progress or cancel an active job. A proposal keeps the exact analyzed version, original source link and provenance. Caption providers retain the original model caption; derived suggestions are labeled separately.

Select individual **Display name** or **Tags** fields and choose **Apply selected changes**. Display names do not rename original files. Select an applied field and choose **Undo selected changes** to undo that field while keeping other approved fields. Both operations compare the analyzed version and expected field value. If a manual edit or replacement intervened, the conflicting field stays unchanged and the UI identifies it for review. Refresh and inspect the latest state before deciding what to do next.

## Archive rules

Create a named rule using minimum age, maximum rating, optional folder and required tags. Rules start disabled; enabling a rule allows the service's scheduled evaluation. A disabled saved rule can still be previewed and run explicitly.

**Preview rule** separates eligible drafts from protected current or historical final selections. Paginate to inspect the remaining candidates. **Run rule** uses the displayed rule revision and produces a retained job report. A changed rule requires a refresh before execution. Archiving is logical: the catalog's archive view can restore assets, and originals remain intact. Deleting a rule does not restore assets that earlier runs archived.

## Script breakdowns

Import a UTF-8 `.txt`, `.md`, or `.fountain` script up to 512 KiB. The original bytes are retained as an immutable asset version and are available through **Download original script**. The offline parser recognizes structured scene, character and prop declarations; it does not claim to understand arbitrary prose. A configured text-analysis provider may reanalyze the retained source.

Edit the title, entity type/name/notes and source-line ranges; add or remove entities and ranges. Saving asks the server to derive exact excerpts from the original source. New entities receive stable server identities. Script revisions prevent one editor from silently replacing another editor's changes. On conflict the draft stays visible; **Reload latest** explicitly replaces it with the saved record.

## Setting documents

Choose **New setting document**, provide a title, document kind and output language, then select assets. Each selected asset offers its retained version history; choose a historical version explicitly when required. Optionally select a retained script and the entities to cite.

Generation copies metadata, exact version IDs/hashes and selected script excerpts into the document. Missing information stays labeled; model suggestions are separate from source facts. Later asset replacement or metadata editing does not change the copied sources. The source panel links to the pinned originals and displays the copied prompt, model, full seed string and notes.

Edit the Markdown and save. Concurrent revision conflicts preserve the draft until **Reload latest** is selected. **Export Markdown** downloads the saved text; **Export structured JSON** includes the saved content and copied sources. Save pending edits before exporting. Saved records remain available after reload; the selected workspace section is retained in the URL.

## Verification

`packages/web/src/automation/*.test.tsx` exercises exact-version selection, delayed-response ownership, selective apply/undo, rule revision checks and pagination, server-allocated entity IDs, draft-preserving conflicts and bilingual navigation. `e2e/automation.spec.ts` uses the real server and browser to cover proposal review, manual-edit conflict protection, historical-final archive protection, rule CRUD, retained bilingual script bytes, editable source excerpts, historical-version documents, exports, reload and light/Chinese presentation. No production API is replaced by a browser mock in these scenarios.
