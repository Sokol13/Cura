# Boards, templates and matrix selections

Boards belong to a single library. They organize references to retained asset versions, so arranging a board does not copy or modify registered source files. Board data lives in Cura's user data database and works offline.

## Workflow

Open **Boards** from a library and choose **New board**. A free canvas can start empty or use a slot template. A matrix starts with **Characters × angles** or **Scenes × options**; its row and column names can be changed later.

The library tray supports asset search and loading more results. Each asset has a version chooser. Drag the chosen version onto the canvas to create an asset item, or into a slot to make a final selection. The tray's add button provides an alternative to dragging: choose a slot first to assign it, or add to the free canvas.

On a free canvas:

- Drag the background to pan, scroll to zoom, or use the zoom and fit controls. The viewport is saved.
- Move and resize items. Add text, edit labels and notes, and use Shift selection to group items. Ungrouping preserves the contained items and their absolute positions.
- Connect the round handles on items. Double-click an item or connection to edit its content or label.
- Add asset slots for named deliverables. Slot frames can move independently of their assigned versions.
- Drag a free asset already on the canvas into a slot to finalize its displayed, pinned version. The free item returns to its saved position and keeps its connections. Dropping outside slots moves the item normally; group or multiple-item drags and overlapping slot targets do not assign.
- Delete selected items or connections with the toolbar or Delete/Backspace outside a text field. Removing a view leaves the library asset available.

Four built-in templates provide Character, Scene, Product and Brand frames. Built-ins are read-only. Their template names, all 13 default slot labels and purpose descriptions follow the English/Chinese interface language, including existing boards. Template purposes appear in selection and management; slot purposes are available as hover and accessible descriptions. Custom template text and renamed slot labels stay exactly as authored. Translation is presentation only: it does not change saved labels, revisions, exports or matrix axes. **Manage templates** creates reusable custom templates with named frames. Editing or deleting a custom template affects future use; existing boards retain their copied frames and original template reference.

Matrices use stable row and column identities. Renaming or reordering an axis preserves each cell's assignment. Adding an axis creates empty cells. Removing an axis archives its cells and clears their current final selections while retaining assignment history. At least one row and one column remain; each axis supports up to 50 entries. Clear an individual matrix cell rather than deleting it independently.

## Versions and final selections

An asset version and a slot version describe different events:

| Record         | Meaning                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------- |
| Asset version  | Retained file bytes and their metadata within an asset's lineage.                           |
| Slot version   | An assignment or clearing event for a named slot. It pins an exact asset and asset version. |
| Board revision | A concurrency token for changes to the board, its layout or its slots.                      |

Assigning a slot creates its next immutable history entry and makes that exact asset version a final selection. Replacing the slot with another pin creates another entry. Assigning the same pin with the current revision is a no-op: it does not change timestamps, history or board revision. Clearing an assigned slot records a clearing entry.

Replacing an asset's file in the library does not move existing board items, slots or slot history to the new bytes. Their exact version references stay intact. Use the tray's version chooser and assign again to select the replacement. The slot's history offers two comparison panes, initially the previous and newest slot revisions. Select distinct revision records; two separate assignments of the same asset version can still be compared. Each pane and list entry shows its historical source filename, asset-version number, actor and time, and offers the exact retained original for download. Cleared entries, unsupported previews and unavailable thumbnails have explicit placeholders. Narrow windows stack the panes.

New assignments and clearing events record the server's currently verified, unexpired signed-in account, or **Local user** when no currently verified, unexpired account is available. Older entries show **Not recorded**; they are never attributed to whoever opens the dialog. Synthetic sync resolutions show **System**. This is historical provenance, not an authentication credential. Viewing or changing the comparison does not write history.

Each slot owns its own final selection. Clearing one slot does not clear a selection owned by another slot or by a manual asset selection. `Asset.finalized` indicates whether the asset's **current** version has an active final selection; an old version can remain selected in a board while a newly replaced current version is not finalized.

Deleting a board archives its slots and removes only their current final selections. Assets, retained bytes, slot history and other owners' selections remain. Deleted board and slot records are retained for whole-library export; there is no board undelete control in this version.

## Saving and recovery

The server validates every request and response against the shared Zod contracts. Cross-library asset/version pins, versions belonging to another asset, group cycles and connections outside the submitted board are rejected before a layout commits. Slot assignment, immutable history and final-selection updates share one SQLite transaction. A persistence failure rolls the operation back.

Board edits carry the last observed `board.revision`. Slot assignment and slot deletion carry that slot's `revision`. A stale value produces HTTP 409 with code `REVISION_CONFLICT`. Canvas-to-slot gestures capture the source pin and target slot revision when dragging starts; only a unique target under the pointer inside the visible canvas is eligible. The client never substitutes the asset current version or saves a second layout mutation for an assignment. The UI reloads the latest saved document and explains that the unconfirmed change was not applied. Review the latest state and repeat the intended edit; the client does not silently retry stale writes.

Ordinary loading or saving errors remain visible with retry controls. A board notification can refresh an open workspace after changes from another window. Notifications invalidate cached reads; the database response remains the authoritative document.

History and pins depend on the retained snapshots in Cura's user data directory. Keep that directory with the library database when backing up Cura. Source-file deletion does not intentionally delete those snapshots. If retained bytes themselves are missing, a historical file download can fail; assigning a newer version is an explicit user action and never an automatic substitution.

## API

Contract source: [`packages/shared/src/boards.ts`](../packages/shared/src/boards.ts). Server registration: [`packages/server/src/boards/routes.ts`](../packages/server/src/boards/routes.ts).

All IDs are UUIDs. Creation names are trimmed and normalized to NFC. Request objects reject unknown fields. Entity responses include `id`, `libraryId`, `createdAt` and `updatedAt`. Lists are plain arrays. Board mutations return the complete `{ board, items, edges, slots }` document, except board deletion, which returns `{ "ok": true }`.

| Method and path                                 | Input                                           | Response                                                           |
| ----------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| `GET /api/libraries/:libraryId/boards`          | —                                               | `Board[]`, active only                                             |
| `POST /api/libraries/:libraryId/boards`         | `CreateBoard`                                   | `BoardDocument`, 201                                               |
| `GET /api/boards/:id`                           | —                                               | `BoardDocument`                                                    |
| `PATCH /api/boards/:id`                         | `UpdateBoard`                                   | `BoardDocument`                                                    |
| `DELETE /api/boards/:id`                        | `{ expectedRevision }` using board revision     | `{ ok: true }`                                                     |
| `PUT /api/boards/:id/layout`                    | `SaveBoardLayout`                               | `BoardDocument`                                                    |
| `POST /api/boards/:id/slots`                    | `CreateBoardSlot`                               | `BoardDocument`, 201                                               |
| `PUT /api/slots/:id/assignment`                 | `{ expectedRevision, pin }` using slot revision | `BoardDocument`                                                    |
| `DELETE /api/slots/:id`                         | `{ expectedRevision }` using slot revision      | `BoardDocument`                                                    |
| `GET /api/slots/:id/history`                    | —                                               | `SlotHistoryEntry[]`, newest first, including archived slots       |
| `GET /api/libraries/:libraryId/slot-templates`  | —                                               | `SlotTemplate[]`, four stable presets plus active custom templates |
| `POST /api/libraries/:libraryId/slot-templates` | `CreateSlotTemplate`                            | `SlotTemplate`, 201                                                |
| `PATCH /api/slot-templates/:id`                 | `UpdateSlotTemplate`                            | `SlotTemplate`                                                     |
| `DELETE /api/slot-templates/:id`                | —                                               | `{ ok: true }`                                                     |

History entries extend portable `SlotRevision` records with a view-only nullable `source`: `{ assetId, versionId, name, type, versionOrdinal }`, joined to the exact retained version. An optional `actor` is `{ kind: "local" }`, `{ kind: "account", id, email }`, or `{ kind: "system", reason: "sync-resolution" }`. Legacy entries omit `actor`. No mutation accepts client-supplied attribution.

A pin is `{ assetId, versionId }`; `null` clears a slot. No endpoint accepts a filename or private snapshot path in place of a pin.

`CreateBoard` accepts `name`, optional `kind` (`canvas` by default), and either a canvas `templateId` or matrix `rows`, `columns` and `matrixPreset`. Axis objects are `{ id, label }`; array order controls display order. Clients retain axis IDs when renaming or moving them.

`SaveBoardLayout` requires `expectedRevision`, the complete `items` array and the complete `edges` array. Omitted existing items or edges are removed. Optional `slotLayouts` patches frame geometry or labels and never changes pins. Matrix geometry is controlled by its axes, so matrix slot-layout patches are rejected. Optional `viewport` updates pan/zoom.

Item and edge IDs are client-generated UUIDs. Items have kind `asset`, `text` or `group`; geometry is stored in absolute board coordinates. An item's optional `groupId` must identify a group in the same submitted layout. Only asset items contain non-null `assetId` and `versionId`. Edges reference item IDs on the same board. Slots are separate records and are not valid connection endpoints.

Board notifications have `{ type: 'board', libraryId, boardId? }`. An omitted `boardId` indicates a library template change. `registerBoardRoutes` accepts a notification callback for the common event transport.

## Persistence and export

Migration `0004_boards.sql` adds `boards`, `board_items`, `board_edges`, `slot_templates`, `slots` and `slot_revisions`. Process migration `0003_process.sql` provides `final_selections`; boards use the shared `setFinalSelection` helper rather than maintaining a second final-selection table.

Migration `0011_slot_revision_actors.sql` adds nullable attribution without rewriting old rows. Portable export and sync preserve actor snapshots but omit the history API’s source display view. Legacy records keep their original semantic hashes. Upgrade all participating sync devices before exchanging newly attributed history; old strict-contract clients do not understand the additive actor field.

`BoardStore.exportLibrary(libraryId): BoardsExport` reads the complete domain in a SQLite transaction. Its arrays are `boards`, `items`, `edges`, `templates`, `slots` and `revisions`. They include board/template/slot tombstones and historical pins. These records contain no private snapshot or cache paths. A neutral export must also include the referenced asset/version bytes and final-selection records; exporting only current public asset pages would omit historical dependencies.

## Verification

The server module has real migrated-SQLite tests for persistence after reopening, ownership, group cycles, stable matrix identity, immutable assignment history, independent final owners, template snapshots and rollback when selection persistence fails. HTTP tests start the real Fastify server on an ephemeral local port, upload actual PNG bytes, replace an asset, and confirm that a slot keeps the old version until explicitly reassigned. They also cover validation, conflict responses, frame edits, deletion and history access.

Browser drag/drop and canvas interaction acceptance belongs to the integrated boards UI E2E suite. HTTP tests do not substitute for that release gate.
