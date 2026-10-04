import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BoardItemInput, BoardPin } from '@cura/shared';
import { openDatabase } from '../src/database.js';
import { CatalogStore } from '../src/catalog-store.js';
import { BoardStore } from '../src/boards/store.js';

const cleanups: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const node = (
  kind: BoardItemInput['kind'],
  values: Partial<BoardItemInput> = {},
): BoardItemInput => ({
  id: randomUUID(),
  kind,
  x: 100,
  y: 200,
  width: 240,
  height: 180,
  groupId: null,
  label: kind,
  text: kind === 'text' ? 'A note' : '',
  assetId: null,
  versionId: null,
  ...values,
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'cura-boards-'));
  const paths = {
    data: join(dir, 'data'),
    cache: join(dir, 'cache'),
    log: join(dir, 'log'),
  };
  let db = openDatabase(paths);
  let catalog = new CatalogStore(db);
  let store = new BoardStore(db);
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  cleanups.push(() => db.close());
  const library = catalog.createLibrary({ name: 'Boards' });
  const root = catalog.addRoot(library.id, join(dir, 'originals'));
  const ingest = (hash: string): BoardPin => {
    const asset = catalog.ingest({
      libraryId: library.id,
      rootId: root.id,
      relativePath: `${hash}.png`,
      actualRelativePath: `${hash}.png`,
      processed: {
        hash,
        size: 42,
        type: 'image/png',
        width: 300,
        height: 200,
        colors: ['#ff0000'],
        phash: '0000000000000000',
        exif: {},
        generation: {
          prompt: 'test',
          negativePrompt: '',
          model: 'model',
          seed: '18446744073709551615',
          source: 'ComfyUI',
          params: {},
        },
        snapshotPath: join(dir, hash),
        thumbnailPath: null,
      },
    }).asset;
    return { assetId: asset.id, versionId: asset.currentVersionId };
  };
  return {
    get db() {
      return db;
    },
    get store() {
      return store;
    },
    get catalog() {
      return catalog;
    },
    library,
    root,
    paths,
    ingest,
    reopen() {
      db.close();
      db = openDatabase(paths);
      catalog = new CatalogStore(db);
      store = new BoardStore(db);
    },
  };
}

describe('board persistence and atomic layout', () => {
  it('persists absolute positions, groups, connections, notes and viewport across reopening', async () => {
    const f = await fixture();
    const pin = f.ingest('a');
    const initial = f.store.createBoard(f.library.id, { name: '画布-e\u0301' });
    const group = node('group', { width: 800, height: 600 });
    const asset = node('asset', { ...pin, groupId: group.id, x: 175, y: 245 });
    const text = node('text', { text: '构图 notes' });
    const edge = {
      id: randomUUID(),
      sourceId: asset.id,
      targetId: text.id,
      label: 'compare',
    };
    const saved = f.store.saveLayout(initial.board.id, {
      expectedRevision: 0,
      items: [asset, text, group],
      edges: [edge],
      viewport: { x: -123, y: 87, zoom: 1.5 },
    });
    expect(saved.board).toMatchObject({
      name: '画布-é',
      revision: 1,
      viewport: { x: -123, y: 87, zoom: 1.5 },
    });
    expect(saved.items.find((item) => item.id === asset.id)).toMatchObject({
      ...pin,
      x: 175,
      y: 245,
      groupId: group.id,
    });
    f.reopen();
    expect(f.store.getBoard(initial.board.id)).toEqual(saved);
    expect(f.store.listBoards(f.library.id)).toEqual([saved.board]);
  });
  it('rejects stale revisions, cross-library pins, foreign endpoints and group cycles without partial writes', async () => {
    const f = await fixture();
    const a = f.store.createBoard(f.library.id, { name: 'A' });
    const text = node('text');
    const saved = f.store.saveLayout(a.board.id, {
      expectedRevision: 0,
      items: [text],
      edges: [],
    });
    expect(() =>
      f.store.updateBoard(a.board.id, { expectedRevision: 0, name: 'stale' }),
    ).toThrowError(
      expect.objectContaining({ code: 'REVISION_CONFLICT', statusCode: 409 }),
    );
    const otherLibrary = f.catalog.createLibrary({ name: 'Other' });
    const otherBoard = f.store.createBoard(otherLibrary.id, {
      name: 'Other board',
    });
    const pin = f.ingest('a');
    expect(() =>
      f.store.saveLayout(otherBoard.board.id, {
        expectedRevision: 0,
        items: [node('asset', pin)],
        edges: [],
      }),
    ).toThrow();
    expect(() =>
      f.store.saveLayout(a.board.id, {
        expectedRevision: 1,
        items: [text],
        edges: [
          {
            id: randomUUID(),
            sourceId: text.id,
            targetId: randomUUID(),
            label: '',
          },
        ],
      }),
    ).toThrow();
    const first = node('group'),
      second = node('group', { groupId: first.id });
    first.groupId = second.id;
    expect(() =>
      f.store.saveLayout(a.board.id, {
        expectedRevision: 1,
        items: [first, second],
        edges: [],
      }),
    ).toThrow();
    expect(f.store.getBoard(a.board.id)).toEqual(saved);
    expect(f.store.getBoard(otherBoard.board.id).items).toEqual([]);
  });
  it('updates and removes layout entities while preserving retained record identities and timestamps', async () => {
    const f = await fixture();
    let doc = f.store.createBoard(f.library.id, { name: 'A' });
    const group = node('group'),
      text = node('text', { groupId: group.id });
    doc = f.store.saveLayout(doc.board.id, {
      expectedRevision: 0,
      items: [group, text],
      edges: [
        {
          id: randomUUID(),
          sourceId: group.id,
          targetId: text.id,
          label: 'link',
        },
      ],
    });
    const before = doc.items.find((item) => item.id === text.id)!;
    doc = f.store.saveLayout(doc.board.id, {
      expectedRevision: 1,
      items: [{ ...text, groupId: null, text: 'edited', x: 500 }],
      edges: [],
    });
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0]).toMatchObject({
      id: text.id,
      createdAt: before.createdAt,
      text: 'edited',
      x: 500,
      groupId: null,
    });
    expect(doc.edges).toEqual([]);
    const renamed = f.store.updateBoard(doc.board.id, {
      expectedRevision: 2,
      name: 'Renamed',
    });
    expect(renamed.board.revision).toBe(3);
  });
});

describe('templates, matrix cells and finalized slots', () => {
  it('seeds four presets and creates independent boards from reusable custom templates', async () => {
    const f = await fixture();
    const presets = f.store.listTemplates(f.library.id);
    expect(presets.map((template) => template.preset).sort()).toEqual([
      'brand',
      'character',
      'product',
      'scene',
    ]);
    expect(f.store.listTemplates(f.library.id)).toEqual(presets);
    const template = f.store.createTemplate(f.library.id, {
      name: 'Custom',
      slots: [
        { key: 'hero', label: 'Hero', x: 20, y: 40, width: 280, height: 200 },
      ],
    });
    const doc = f.store.createBoard(f.library.id, {
      name: 'From custom',
      templateId: template.id,
    });
    expect(doc.slots).toHaveLength(1);
    expect(doc.slots[0]).toMatchObject({
      templateKey: 'hero',
      label: 'Hero',
      x: 20,
      y: 40,
      currentPin: null,
    });
    f.store.updateTemplate(template.id, {
      name: 'Updated',
      slots: [
        { key: 'other', label: 'Other', x: 0, y: 0, width: 240, height: 180 },
      ],
    });
    expect(f.store.getBoard(doc.board.id).slots[0]?.label).toBe('Hero');
    expect(() =>
      f.store.updateTemplate(presets[0]!.id, { name: 'Alter builtin' }),
    ).toThrow();
    f.store.deleteTemplate(template.id);
    expect(f.store.listTemplates(f.library.id)).toHaveLength(4);
    expect(f.store.getBoard(doc.board.id).board.templateId).toBe(template.id);
    expect(
      f.store
        .exportLibrary(f.library.id)
        .templates.find((item) => item.id === template.id)?.deletedAt,
    ).not.toBeNull();
  });
  it('pins historical bytes, appends slot history, treats repeated assignment as a no-op and preserves other owners', async () => {
    const f = await fixture();
    const first = f.ingest('a'),
      second = f.ingest('b');
    let doc = f.store.createBoard(f.library.id, {
      name: 'Finals',
      templateId: f.store.listTemplates(f.library.id)[0]!.id,
    });
    const slot = doc.slots[0]!,
      other = doc.slots[1]!;
    doc = f.store.assignSlot(slot.id, { expectedRevision: 0, pin: first });
    expect(doc.slots.find((s) => s.id === slot.id)).toMatchObject({
      revision: 1,
      currentPin: first,
    });
    expect(f.catalog.getAsset(first.assetId).finalized).toBe(true);
    const unchanged = f.store.assignSlot(slot.id, {
      expectedRevision: 1,
      pin: first,
    });
    expect(unchanged.board.revision).toBe(doc.board.revision);
    expect(f.store.listSlotHistory(slot.id)).toHaveLength(1);
    f.store.assignSlot(other.id, { expectedRevision: 0, pin: first });
    doc = f.store.assignSlot(slot.id, { expectedRevision: 1, pin: second });
    expect(
      f.store.listSlotHistory(slot.id).map((version) => version.pin),
    ).toEqual([second, first]);
    expect(f.catalog.getAsset(first.assetId).finalized).toBe(true);
    expect(() =>
      f.store.assignSlot(slot.id, { expectedRevision: 1, pin: first }),
    ).toThrow();
    f.store.assignSlot(other.id, { expectedRevision: 1, pin: null });
    expect(f.catalog.getAsset(first.assetId).finalized).toBe(false);
    f.store.deleteBoard(doc.board.id, {
      expectedRevision: f.store.getBoard(doc.board.id).board.revision,
    });
    expect(f.catalog.getAsset(second.assetId).finalized).toBe(false);
    expect(f.store.listBoards(f.library.id)).toEqual([]);
    expect(
      f.store
        .listSlotHistory(slot.id)
        .some((version) => version.pin?.versionId === first.versionId),
    ).toBe(true);
    expect(
      f.store.exportLibrary(f.library.id).boards[0]?.deletedAt,
    ).not.toBeNull();
  });
  it('validates pin ownership atomically and rolls back when final-selection persistence fails', async () => {
    const f = await fixture();
    const first = f.ingest('a'),
      second = f.ingest('b');
    const doc = f.store.createSlot(
      f.store.createBoard(f.library.id, { name: 'A' }).board.id,
      { expectedRevision: 0, label: 'Hero' },
    );
    const slot = doc.slots[0]!;
    expect(() =>
      f.store.assignSlot(slot.id, {
        expectedRevision: 0,
        pin: { assetId: first.assetId, versionId: second.versionId },
      }),
    ).toThrow();
    const foreign = f.catalog.createLibrary({ name: 'Foreign' });
    const foreignDoc = f.store.createSlot(
      f.store.createBoard(foreign.id, { name: 'B' }).board.id,
      { expectedRevision: 0, label: 'Other' },
    );
    expect(() =>
      f.store.assignSlot(foreignDoc.slots[0]!.id, {
        expectedRevision: 0,
        pin: first,
      }),
    ).toThrow();
    f.db.sqlite.exec(
      "CREATE TRIGGER fail_board_selection BEFORE INSERT ON final_selections WHEN NEW.owner_kind='slot' BEGIN SELECT RAISE(ABORT,'simulated final failure'); END;",
    );
    expect(() =>
      f.store.assignSlot(slot.id, { expectedRevision: 0, pin: first }),
    ).toThrow('simulated final failure');
    expect(f.store.getBoard(doc.board.id)).toEqual(doc);
    expect(f.store.listSlotHistory(slot.id)).toEqual([]);
    expect(f.catalog.getAsset(first.assetId).finalized).toBe(false);
  });
  it('preserves matrix cell IDs and selections through axis reorder/rename and archives removed cells', async () => {
    const f = await fixture();
    const rows = [
        { id: randomUUID(), label: '角色甲' },
        { id: randomUUID(), label: '角色乙' },
      ],
      columns = [
        { id: randomUUID(), label: 'Close' },
        { id: randomUUID(), label: 'Wide' },
      ];
    let doc = f.store.createBoard(f.library.id, {
      name: 'Matrix',
      kind: 'matrix',
      rows,
      columns,
    });
    expect(doc.slots).toHaveLength(4);
    const cell = doc.slots.find(
      (slot) => slot.rowId === rows[0]!.id && slot.columnId === columns[0]!.id,
    )!;
    const pin = f.ingest('a');
    doc = f.store.assignSlot(cell.id, { expectedRevision: 0, pin });
    doc = f.store.updateBoard(doc.board.id, {
      expectedRevision: doc.board.revision,
      rows: [rows[1]!, { ...rows[0]!, label: 'Renamed' }],
      columns: [columns[1]!, columns[0]!],
    });
    expect(doc.slots.find((slot) => slot.id === cell.id)).toMatchObject({
      currentPin: pin,
      rowId: rows[0]!.id,
      columnId: columns[0]!.id,
      label: 'Renamed · Close',
    });
    doc = f.store.updateBoard(doc.board.id, {
      expectedRevision: doc.board.revision,
      columns: [...columns, { id: randomUUID(), label: '35°' }],
    });
    expect(doc.slots).toHaveLength(6);
    doc = f.store.updateBoard(doc.board.id, {
      expectedRevision: doc.board.revision,
      rows: [rows[1]!],
    });
    expect(doc.slots).toHaveLength(3);
    expect(f.catalog.getAsset(pin.assetId).finalized).toBe(false);
    expect(
      f.store
        .listSlotHistory(cell.id)
        .some((version) => version.pin?.versionId === pin.versionId),
    ).toBe(true);
    const exported = f.store.exportLibrary(f.library.id);
    expect(exported.slots).toHaveLength(6);
    expect(
      exported.slots.find((slot) => slot.id === cell.id)?.deletedAt,
    ).not.toBeNull();
    f.reopen();
    expect(f.store.getBoard(doc.board.id)).toEqual(doc);
  });
});
