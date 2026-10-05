import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, expect, it } from 'vitest';
import type { SlotActor } from '@cura/shared';
import { BoardStore } from '../src/boards/store.js';
import { CatalogStore } from '../src/catalog-store.js';
import {
  MIGRATIONS_ROOT,
  openDatabase,
  type AppDatabase,
} from '../src/database.js';
import * as schema from '../src/schema.js';
import { readPortableGraph, semanticHash } from '../src/sync/portable.js';
const cleanups: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function fixture(legacy = false) {
  const directory = await mkdtemp(join(tmpdir(), 'cura-slot-history-'));
  const paths = {
    data: join(directory, 'data'),
    cache: join(directory, 'cache'),
    log: join(directory, 'log'),
  };
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  let db: AppDatabase;
  if (legacy) {
    await mkdir(paths.data, { recursive: true });
    const migrations = join(directory, 'old-migrations');
    await cp(MIGRATIONS_ROOT, migrations, { recursive: true });
    const journal = JSON.parse(
      await readFile(join(migrations, 'meta', '_journal.json'), 'utf8'),
    );
    journal.entries = journal.entries.filter(
      (entry: { idx: number }) => entry.idx <= 10,
    );
    await writeFile(
      join(migrations, 'meta', '_journal.json'),
      JSON.stringify(journal),
    );
    const sqlite = new Database(join(paths.data, 'cura.sqlite'));
    sqlite.pragma('foreign_keys=ON');
    const database = drizzle(sqlite, { schema });
    migrate(database, { migrationsFolder: migrations });
    db = { sqlite, database, close: () => sqlite.close() };
  } else db = openDatabase(paths);
  cleanups.push(() => db.close());
  const catalog = new CatalogStore(db);
  const library = catalog.createLibrary({ name: 'History' });
  let actor: SlotActor = {
    kind: 'account',
    id: randomUUID(),
    email: 'maker@example.test',
  };
  let calls = 0;
  const boards = new BoardStore(db, () => {
    calls++;
    return actor;
  });
  let document = boards.createBoard(library.id, { name: 'Board' });
  document = boards.createSlot(document.board.id, {
    expectedRevision: 0,
    label: 'Hero',
  });
  const slot = document.slots[0]!;
  const root = catalog.addRoot(library.id, join(directory, 'originals'));
  const processed = (hash: string) => ({
    hash: hash.repeat(64),
    size: 12,
    type: 'image/png',
    width: 1,
    height: 1,
    colors: [],
    phash: '0000000000000000',
    exif: {},
    generation: {
      prompt: '',
      negativePrompt: '',
      model: '',
      seed: '18446744073709551615',
      source: '',
      params: {},
    },
    snapshotPath: join(directory, hash),
    thumbnailPath: null,
  });
  const asset = catalog.ingest({
    libraryId: library.id,
    rootId: root.id,
    relativePath: 'original-v1.png',
    actualRelativePath: 'original-v1.png',
    processed: processed('a'),
  }).asset;
  return {
    get db() {
      return db;
    },
    paths,
    library,
    catalog,
    boards,
    slot,
    asset,
    processed,
    get calls() {
      return calls;
    },
    setActor(value: SlotActor) {
      actor = value;
    },
    reopen() {
      db.close();
      db = openDatabase(paths);
      return new BoardStore(db);
    },
  };
}
it('records server attribution once per actual assignment, including clears, and rejects forged input', async () => {
  const f = await fixture();
  const pin = { assetId: f.asset.id, versionId: f.asset.currentVersionId };
  f.boards.assignSlot(f.slot.id, { expectedRevision: 0, pin });
  const first = f.boards.listSlotHistory(f.slot.id)[0]!;
  expect(first.actor).toMatchObject({
    kind: 'account',
    email: 'maker@example.test',
  });
  expect(f.calls).toBe(1);
  f.setActor({ kind: 'local' });
  f.boards.assignSlot(f.slot.id, { expectedRevision: 1, pin });
  expect(f.calls).toBe(1);
  expect(f.boards.listSlotHistory(f.slot.id)).toEqual([first]);
  expect(() =>
    f.boards.assignSlot(f.slot.id, {
      expectedRevision: 1,
      pin: null,
      actor: { kind: 'system', reason: 'sync-resolution' },
    } as never),
  ).toThrow();
  f.boards.deleteSlot(f.slot.id, { expectedRevision: 1 });
  expect(f.boards.listSlotHistory(f.slot.id)[0]).toMatchObject({
    actor: { kind: 'local' },
    pin: null,
    source: null,
  });
  expect(f.calls).toBe(2);
});
it('enriches history from the exact historical source after replacement, rename and Trash without exporting its view', async () => {
  const f = await fixture();
  f.boards.assignSlot(f.slot.id, {
    expectedRevision: 0,
    pin: { assetId: f.asset.id, versionId: f.asset.currentVersionId },
  });
  f.catalog.replaceAsset(f.asset.id, f.processed('b'), 'replacement-v2.png');
  f.catalog.updateAsset(f.asset.id, { displayName: 'Renamed current title' });
  f.catalog.batchAssets(f.library.id, {
    assetIds: [f.asset.id],
    action: 'trash',
  });
  const history = f.boards.listSlotHistory(f.slot.id);
  expect(history[0]?.source).toEqual({
    assetId: f.asset.id,
    versionId: f.asset.currentVersionId,
    name: 'original-v1.png',
    type: 'image/png',
    versionOrdinal: 1,
  });
  const exported = f.boards.exportLibrary(f.library.id);
  expect(exported.revisions[0]?.actor).toEqual(history[0]?.actor);
  expect(exported.revisions[0]).not.toHaveProperty('source');
  const record = readPortableGraph(f.db, f.library.id).records.find(
    (record) => record.kind === 'board',
  );
  expect(record?.data).not.toHaveProperty('revisions.0.source');
});
it('upgrades legacy NULL attribution without changing old portable hashes or authored history', async () => {
  const f = await fixture(true);
  const date = '2025-01-01T00:00:00.000Z';
  f.db.sqlite
    .prepare(
      'INSERT INTO slot_revisions (id,library_id,slot_id,ordinal,asset_id,version_id,created_at,updated_at) VALUES (?,?,?,1,NULL,NULL,?,?)',
    )
    .run(randomUUID(), f.library.id, f.slot.id, date, date);
  f.db.sqlite.prepare('UPDATE slots SET revision=1 WHERE id=?').run(f.slot.id);
  const old = f.boards.exportLibrary(f.library.id).revisions;
  const hash = semanticHash(readPortableGraph(f.db, f.library.id));
  const reopened = f.reopen();
  expect(reopened.exportLibrary(f.library.id).revisions).toEqual(old);
  expect(reopened.listSlotHistory(f.slot.id)[0]).not.toHaveProperty('actor');
  expect(semanticHash(readPortableGraph(f.db, f.library.id))).toBe(hash);
  expect(
    f.db.sqlite.prepare('SELECT actor_json FROM slot_revisions').get(),
  ).toEqual({ actor_json: null });
  expect(f.db.sqlite.pragma('integrity_check')).toEqual([
    { integrity_check: 'ok' },
  ]);
  expect(f.db.sqlite.pragma('foreign_key_check')).toEqual([]);
  f.reopen();
  expect(semanticHash(readPortableGraph(f.db, f.library.id))).toBe(hash);
});
