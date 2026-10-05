import { randomUUID } from 'node:crypto';
import * as S from '@cura/shared';
import type { AppDatabase } from '../database.js';
import { CatalogError } from '../catalog-store.js';
import { setFinalSelection } from '../process/final-selections.js';
import { boardPresets } from './presets.js';

type Row = Record<string, unknown>;
type Value = string | number | null;
const now = () => new Date().toISOString();
const camel = (row: Row): Row =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );
function invalid(message: string): never {
  throw new CatalogError(message, 'INVALID_BOARD', 400);
}
const conflict = (): never => {
  throw new CatalogError(
    'This board changed. Reload the latest version before saving.',
    'REVISION_CONFLICT',
    409,
  );
};
const unique = (ids: string[], message: string) => {
  if (new Set(ids).size !== ids.length) invalid(message);
};
const pin = (row: Row): S.BoardPin | null =>
  row.asset_id === null
    ? null
    : { assetId: String(row.asset_id), versionId: String(row.version_id) };

export class BoardStore {
  constructor(
    private readonly db: AppDatabase,
    private readonly actorProvider: () => S.SlotActor = () => ({
      kind: 'local',
    }),
  ) {}
  private row(sql: string, ...params: Value[]): Row | undefined {
    return this.db.sqlite.prepare(sql).get(...params) as Row | undefined;
  }
  private rows(sql: string, ...params: Value[]): Row[] {
    return this.db.sqlite.prepare(sql).all(...params) as Row[];
  }
  private run(sql: string, ...params: Value[]) {
    return this.db.sqlite.prepare(sql).run(...params);
  }
  private required(table: string, id: string): Row {
    const row = this.row(`SELECT * FROM ${table} WHERE id=?`, id);
    if (!row) throw new CatalogError(`${table} record not found`);
    return row;
  }
  private library(id: string): void {
    this.required('libraries', id);
  }
  private boardRow(id: string, expected?: number): Row {
    const row = this.required('boards', id);
    if (row.deleted_at) throw new CatalogError('Board not found');
    if (expected !== undefined && row.revision !== expected) conflict();
    return row;
  }
  private slotRow(id: string, expected?: number): Row {
    const row = this.required('slots', id);
    if (row.deleted_at) throw new CatalogError('Slot not found');
    this.boardRow(String(row.board_id));
    if (expected !== undefined && row.revision !== expected) conflict();
    return row;
  }
  private board(row: Row): S.Board {
    return S.BoardSchema.parse({
      ...camel(row),
      viewport: JSON.parse(String(row.viewport)),
      rows: JSON.parse(String(row.rows_json)),
      columns: JSON.parse(String(row.columns_json)),
    });
  }
  private slot(row: Row): S.BoardSlot {
    return S.BoardSlotSchema.parse({ ...camel(row), currentPin: pin(row) });
  }
  private template(row: Row): S.SlotTemplate {
    return S.SlotTemplateSchema.parse({
      ...camel(row),
      slots: JSON.parse(String(row.slots_json)),
    });
  }
  private revision(row: Row): S.SlotRevision {
    return S.SlotRevisionSchema.parse({
      ...camel(row),
      pin: pin(row),
      ...(row.actor_json == null
        ? {}
        : {
            actor: S.SlotActorSchema.parse(JSON.parse(String(row.actor_json))),
          }),
    });
  }
  private checkPin(libraryId: string, value: S.BoardPin): void {
    const row = this.row(
      'SELECT v.asset_id,a.library_id FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=?',
      value.versionId,
    );
    if (!row || row.asset_id !== value.assetId || row.library_id !== libraryId)
      invalid('The asset version must belong to this asset and library');
  }
  private bump(boardId: string): void {
    this.run(
      'UPDATE boards SET revision=revision+1,updated_at=? WHERE id=?',
      now(),
      boardId,
    );
  }
  private activity(libraryId: string, action: string, details: Row): void {
    const date = now();
    this.run(
      'INSERT INTO activity VALUES (?,?,NULL,?,?,?,?)',
      randomUUID(),
      libraryId,
      action,
      JSON.stringify(details),
      date,
      date,
    );
  }

  listBoards(libraryId: string): S.Board[] {
    this.library(libraryId);
    return this.rows(
      'SELECT * FROM boards WHERE library_id=? AND deleted_at IS NULL ORDER BY updated_at DESC,id',
      libraryId,
    ).map((row) => this.board(row));
  }
  getBoard(id: string): S.BoardDocument {
    const board = this.board(this.boardRow(id));
    return S.BoardDocumentSchema.parse({
      board,
      items: this.rows(
        "SELECT * FROM board_items WHERE board_id=? ORDER BY CASE kind WHEN 'group' THEN 0 ELSE 1 END,created_at,id",
        id,
      ).map((row) => S.BoardItemSchema.parse(camel(row))),
      edges: this.rows(
        'SELECT * FROM board_edges WHERE board_id=? ORDER BY created_at,id',
        id,
      ).map((row) => S.BoardEdgeSchema.parse(camel(row))),
      slots: this.rows(
        'SELECT * FROM slots WHERE board_id=? AND deleted_at IS NULL ORDER BY y,x,created_at,id',
        id,
      ).map((row) => this.slot(row)),
    });
  }
  createBoard(libraryId: string, input: S.CreateBoard): S.BoardDocument {
    const data = S.CreateBoardSchema.parse(input);
    return this.db.sqlite.transaction(() => {
      this.library(libraryId);
      let template: S.SlotTemplate | undefined;
      if (data.templateId) {
        template = this.template(
          this.required('slot_templates', data.templateId),
        );
        if (template.libraryId !== libraryId || template.deletedAt)
          invalid('Template must belong to this library and be active');
      }
      const matrix = data.kind === 'matrix';
      const scene = data.matrixPreset === 'scene-option';
      const rows = matrix
        ? (data.rows ??
          [1, 2].map((index) => ({
            id: randomUUID(),
            label: `${scene ? 'Scene' : 'Character'} ${index}`,
          })))
        : [];
      const columns = matrix
        ? (data.columns ??
          (scene
            ? ['Option 1', 'Option 2']
            : ['Reference', 'Close-up', 'Wide shot', '35°']
          ).map((label) => ({ id: randomUUID(), label })))
        : [];
      const id = randomUUID(),
        date = now();
      this.run(
        'INSERT INTO boards VALUES (?,?,?,?,0,?,?,?,?,NULL,?,?)',
        id,
        libraryId,
        data.name,
        data.kind,
        JSON.stringify({ x: 0, y: 0, zoom: 1 }),
        JSON.stringify(rows),
        JSON.stringify(columns),
        template?.id ?? null,
        date,
        date,
      );
      const board = this.board(this.boardRow(id));
      if (template)
        for (const frame of template.slots)
          this.insertSlot(board, frame, null, null, frame.key);
      if (matrix) this.reconcileCells(board);
      this.activity(libraryId, 'board.create', { boardId: id });
      return this.getBoard(id);
    })();
  }
  updateBoard(id: string, input: S.UpdateBoard): S.BoardDocument {
    const data = S.UpdateBoardSchema.parse(input);
    return this.db.sqlite.transaction(() => {
      const board = this.board(this.boardRow(id, data.expectedRevision));
      if (board.kind !== 'matrix' && (data.rows || data.columns))
        invalid('Only matrix boards have axes');
      const updated = {
        ...board,
        name: data.name ?? board.name,
        viewport: data.viewport ?? board.viewport,
        rows: data.rows ?? board.rows,
        columns: data.columns ?? board.columns,
      };
      this.run(
        'UPDATE boards SET name=?,viewport=?,rows_json=?,columns_json=? WHERE id=?',
        updated.name,
        JSON.stringify(updated.viewport),
        JSON.stringify(updated.rows),
        JSON.stringify(updated.columns),
        id,
      );
      if (data.rows || data.columns) this.reconcileCells(updated);
      this.bump(id);
      return this.getBoard(id);
    })();
  }
  saveLayout(id: string, input: S.SaveBoardLayout): S.BoardDocument {
    const data = S.SaveBoardLayoutSchema.parse(input);
    return this.db.sqlite.transaction(() => {
      const board = this.board(this.boardRow(id, data.expectedRevision));
      unique(
        data.items.map((item) => item.id),
        'Item IDs must be unique',
      );
      unique(
        data.edges.map((edge) => edge.id),
        'Edge IDs must be unique',
      );
      unique(
        (data.slotLayouts ?? []).map((slot) => slot.id),
        'Slot layout IDs must be unique',
      );
      const items = new Map(data.items.map((item) => [item.id, item]));
      for (const item of data.items) {
        const existing = this.row(
          'SELECT board_id FROM board_items WHERE id=?',
          item.id,
        );
        if (existing && existing.board_id !== id)
          invalid('An item cannot move between boards');
        if (item.kind === 'asset')
          this.checkPin(board.libraryId, {
            assetId: item.assetId!,
            versionId: item.versionId!,
          });
        let parentId = item.groupId;
        const visited = new Set([item.id]);
        while (parentId) {
          if (visited.has(parentId)) invalid('Groups cannot contain cycles');
          visited.add(parentId);
          const parent = items.get(parentId);
          if (!parent || parent.kind !== 'group')
            invalid('An item parent must be a group on the same board');
          parentId = parent.groupId;
        }
      }
      for (const edge of data.edges) {
        if (!items.has(edge.sourceId) || !items.has(edge.targetId))
          invalid('Connection endpoints must belong to this board');
        const previous = this.row(
          'SELECT board_id FROM board_edges WHERE id=?',
          edge.id,
        );
        if (previous && previous.board_id !== id)
          invalid('A connection cannot move between boards');
      }
      for (const layout of data.slotLayouts ?? []) {
        const slot = this.slotRow(layout.id);
        if (slot.board_id !== id)
          invalid('Slot layouts must belong to this board');
        if (board.kind === 'matrix')
          invalid('Matrix cell layout is controlled by its axes');
      }
      const previousEdges = new Map(
        this.rows(
          'SELECT id,created_at FROM board_edges WHERE board_id=?',
          id,
        ).map((row) => [String(row.id), String(row.created_at)]),
      );
      this.run('DELETE FROM board_edges WHERE board_id=?', id);
      for (const existing of this.rows(
        'SELECT id FROM board_items WHERE board_id=?',
        id,
      ))
        if (!items.has(String(existing.id)))
          this.run('DELETE FROM board_items WHERE id=?', String(existing.id));
      const date = now();
      for (const item of data.items)
        this.run(
          'INSERT INTO board_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,x=excluded.x,y=excluded.y,width=excluded.width,height=excluded.height,group_id=excluded.group_id,label=excluded.label,text=excluded.text,asset_id=excluded.asset_id,version_id=excluded.version_id,updated_at=excluded.updated_at',
          item.id,
          board.libraryId,
          id,
          item.kind,
          item.x,
          item.y,
          item.width,
          item.height,
          item.groupId,
          item.label,
          item.text,
          item.assetId,
          item.versionId,
          date,
          date,
        );
      for (const edge of data.edges)
        this.run(
          'INSERT INTO board_edges VALUES (?,?,?,?,?,?,?,?)',
          edge.id,
          board.libraryId,
          id,
          edge.sourceId,
          edge.targetId,
          edge.label,
          previousEdges.get(edge.id) ?? date,
          date,
        );
      for (const layout of data.slotLayouts ?? []) {
        const slot = this.slot(this.slotRow(layout.id));
        this.run(
          'UPDATE slots SET label=?,x=?,y=?,width=?,height=?,updated_at=? WHERE id=?',
          layout.label ?? slot.label,
          layout.x ?? slot.x,
          layout.y ?? slot.y,
          layout.width ?? slot.width,
          layout.height ?? slot.height,
          date,
          slot.id,
        );
      }
      if (data.viewport)
        this.run(
          'UPDATE boards SET viewport=? WHERE id=?',
          JSON.stringify(data.viewport),
          id,
        );
      this.bump(id);
      return this.getBoard(id);
    })();
  }
  deleteBoard(id: string, input: { expectedRevision: number }): void {
    const data = S.BoardRevisionRequestSchema.parse(input);
    this.db.sqlite.transaction(() => {
      const board = this.board(this.boardRow(id, data.expectedRevision));
      for (const row of this.rows(
        'SELECT * FROM slots WHERE board_id=? AND deleted_at IS NULL',
        id,
      ))
        this.archiveSlot(row);
      this.run(
        'UPDATE boards SET deleted_at=?,updated_at=?,revision=revision+1 WHERE id=?',
        now(),
        now(),
        id,
      );
      this.activity(board.libraryId, 'board.delete', { boardId: id });
    })();
  }
  private insertSlot(
    board: S.Board,
    frame: {
      label: string;
      x: number;
      y: number;
      width: number;
      height: number;
    },
    rowId: string | null = null,
    columnId: string | null = null,
    templateKey: string | null = null,
  ): void {
    const date = now();
    this.run(
      'INSERT INTO slots VALUES (?,?,?,?,?,?,?,?,?,?,?,0,NULL,NULL,NULL,?,?)',
      randomUUID(),
      board.libraryId,
      board.id,
      frame.label,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      rowId,
      columnId,
      templateKey,
      date,
      date,
    );
  }
  createSlot(boardId: string, input: S.CreateBoardSlot): S.BoardDocument {
    const data = S.CreateBoardSlotSchema.parse(input);
    return this.db.sqlite.transaction(() => {
      const board = this.board(this.boardRow(boardId, data.expectedRevision));
      if (board.kind === 'matrix')
        invalid('Add matrix rows or columns to create cells');
      this.insertSlot(board, data);
      this.bump(boardId);
      return this.getBoard(boardId);
    })();
  }
  private recordAssignment(slot: Row, value: S.BoardPin | null): void {
    const ordinal = Number(slot.revision) + 1,
      date = now(),
      libraryId = String(slot.library_id),
      id = String(slot.id);
    this.run(
      'INSERT INTO slot_revisions (id,library_id,slot_id,ordinal,asset_id,version_id,created_at,updated_at,actor_json) VALUES (?,?,?,?,?,?,?,?,?)',
      randomUUID(),
      libraryId,
      id,
      ordinal,
      value?.assetId ?? null,
      value?.versionId ?? null,
      date,
      date,
      JSON.stringify(S.SlotActorSchema.parse(this.actorProvider())),
    );
    this.run(
      'UPDATE slots SET asset_id=?,version_id=?,revision=?,updated_at=? WHERE id=?',
      value?.assetId ?? null,
      value?.versionId ?? null,
      ordinal,
      date,
      id,
    );
    setFinalSelection(
      this.db,
      { libraryId, ownerKind: 'slot', ownerId: id },
      value,
    );
  }
  assignSlot(id: string, input: S.AssignBoardSlot): S.BoardDocument {
    const data = S.AssignBoardSlotSchema.parse(input);
    return this.db.sqlite.transaction(() => {
      const slot = this.slotRow(id, data.expectedRevision),
        boardId = String(slot.board_id);
      if (data.pin) this.checkPin(String(slot.library_id), data.pin);
      const previous = pin(slot);
      if (
        previous?.assetId === data.pin?.assetId &&
        previous?.versionId === data.pin?.versionId
      )
        return this.getBoard(boardId);
      this.recordAssignment(slot, data.pin);
      this.bump(boardId);
      this.activity(String(slot.library_id), 'slot.assign', {
        slotId: id,
        boardId,
        pin: data.pin,
      });
      return this.getBoard(boardId);
    })();
  }
  private archiveSlot(slot: Row): void {
    if (slot.asset_id !== null) this.recordAssignment(slot, null);
    else
      setFinalSelection(
        this.db,
        {
          libraryId: String(slot.library_id),
          ownerKind: 'slot',
          ownerId: String(slot.id),
        },
        null,
      );
    const date = now();
    this.run(
      'UPDATE slots SET deleted_at=?,updated_at=? WHERE id=?',
      date,
      date,
      String(slot.id),
    );
  }
  deleteSlot(id: string, input: { expectedRevision: number }): S.BoardDocument {
    const data = S.BoardRevisionRequestSchema.parse(input);
    return this.db.sqlite.transaction(() => {
      const slot = this.slotRow(id, data.expectedRevision);
      if (slot.row_id !== null)
        invalid('Remove a matrix axis or clear the cell instead');
      this.archiveSlot(slot);
      this.bump(String(slot.board_id));
      return this.getBoard(String(slot.board_id));
    })();
  }
  listSlotHistory(id: string): S.SlotHistoryEntry[] {
    this.required('slots', id);
    return this.rows(
      `SELECT r.*,v.payload AS version_payload,v.ordinal AS version_ordinal FROM slot_revisions r
      LEFT JOIN asset_versions v ON v.id=r.version_id AND v.asset_id=r.asset_id
      WHERE r.slot_id=? ORDER BY r.ordinal DESC`,
      id,
    ).map((row) => {
      const version =
        row.version_payload == null
          ? null
          : S.AssetVersionSchema.parse(JSON.parse(String(row.version_payload)));
      return S.SlotHistoryEntrySchema.parse({
        ...this.revision(row),
        source: version
          ? {
              assetId: String(row.asset_id),
              versionId: String(row.version_id),
              name: version.name,
              type: version.type,
              versionOrdinal: Number(row.version_ordinal),
            }
          : null,
      });
    });
  }
  private reconcileCells(board: S.Board): void {
    const cells = this.rows('SELECT * FROM slots WHERE board_id=?', board.id);
    const keys = new Set<string>();
    board.rows.forEach((row, r) =>
      board.columns.forEach((column, c) => {
        const key = `${row.id}:${column.id}`;
        keys.add(key);
        const existing = cells.find(
          (slot) => slot.row_id === row.id && slot.column_id === column.id,
        );
        const frame = {
          label: `${row.label} · ${column.label}`,
          x: c * 280 + 20,
          y: r * 220 + 20,
          width: 240,
          height: 180,
        };
        if (existing)
          this.run(
            'UPDATE slots SET label=?,x=?,y=?,deleted_at=NULL,updated_at=? WHERE id=?',
            frame.label,
            frame.x,
            frame.y,
            now(),
            String(existing.id),
          );
        else this.insertSlot(board, frame, row.id, column.id);
      }),
    );
    for (const slot of cells)
      if (
        slot.deleted_at === null &&
        !keys.has(`${String(slot.row_id)}:${String(slot.column_id)}`)
      )
        this.archiveSlot(slot);
  }

  listTemplates(libraryId: string): S.SlotTemplate[] {
    return this.db.sqlite.transaction(() => {
      this.library(libraryId);
      const date = now();
      for (const preset of boardPresets)
        this.run(
          'INSERT OR IGNORE INTO slot_templates VALUES (?,?,?,?,?,NULL,?,?)',
          randomUUID(),
          libraryId,
          preset.name,
          preset.preset,
          JSON.stringify(preset.slots),
          date,
          date,
        );
      return this.rows(
        'SELECT * FROM slot_templates WHERE library_id=? AND deleted_at IS NULL ORDER BY name,id',
        libraryId,
      ).map((row) => this.template(row));
    })();
  }
  createTemplate(
    libraryId: string,
    input: S.CreateSlotTemplate,
  ): S.SlotTemplate {
    const data = S.CreateSlotTemplateSchema.parse(input);
    return this.db.sqlite.transaction(() => {
      this.library(libraryId);
      const id = randomUUID(),
        date = now();
      this.run(
        'INSERT INTO slot_templates VALUES (?,?,?,NULL,?,NULL,?,?)',
        id,
        libraryId,
        data.name,
        JSON.stringify(data.slots),
        date,
        date,
      );
      return this.template(this.required('slot_templates', id));
    })();
  }
  updateTemplate(id: string, input: S.UpdateSlotTemplate): S.SlotTemplate {
    const data = S.UpdateSlotTemplateSchema.parse(input);
    return this.db.sqlite.transaction(() => {
      const current = this.template(this.required('slot_templates', id));
      if (current.deletedAt) throw new CatalogError('Template not found');
      if (current.preset)
        invalid('Built-in templates are read-only; create a custom template');
      this.run(
        'UPDATE slot_templates SET name=?,slots_json=?,updated_at=? WHERE id=?',
        data.name ?? current.name,
        JSON.stringify(data.slots ?? current.slots),
        now(),
        id,
      );
      return this.template(this.required('slot_templates', id));
    })();
  }
  deleteTemplate(id: string): S.SlotTemplate {
    return this.db.sqlite.transaction(() => {
      const current = this.template(this.required('slot_templates', id));
      if (current.deletedAt) throw new CatalogError('Template not found');
      if (current.preset) invalid('Built-in templates cannot be deleted');
      this.run(
        'UPDATE slot_templates SET deleted_at=?,updated_at=? WHERE id=?',
        now(),
        now(),
        id,
      );
      return this.template(this.required('slot_templates', id));
    })();
  }
  exportLibrary(libraryId: string): S.BoardsExport {
    return this.db.sqlite.transaction(() => {
      this.library(libraryId);
      return S.BoardsExportSchema.parse({
        boards: this.rows(
          'SELECT * FROM boards WHERE library_id=? ORDER BY created_at,id',
          libraryId,
        ).map((row) => this.board(row)),
        items: this.rows(
          'SELECT * FROM board_items WHERE library_id=? ORDER BY created_at,id',
          libraryId,
        ).map((row) => S.BoardItemSchema.parse(camel(row))),
        edges: this.rows(
          'SELECT * FROM board_edges WHERE library_id=? ORDER BY created_at,id',
          libraryId,
        ).map((row) => S.BoardEdgeSchema.parse(camel(row))),
        templates: this.rows(
          'SELECT * FROM slot_templates WHERE library_id=? ORDER BY created_at,id',
          libraryId,
        ).map((row) => this.template(row)),
        slots: this.rows(
          'SELECT * FROM slots WHERE library_id=? ORDER BY created_at,id',
          libraryId,
        ).map((row) => this.slot(row)),
        revisions: this.rows(
          'SELECT * FROM slot_revisions WHERE library_id=? ORDER BY created_at,id',
          libraryId,
        ).map((row) => this.revision(row)),
      });
    })();
  }
}
