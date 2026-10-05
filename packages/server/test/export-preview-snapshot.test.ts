import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import * as C from '@cura/shared';
import { openDatabase } from '../src/database.js';
import { resolveUserPaths } from '../src/paths.js';
import { CatalogStore } from '../src/catalog-store.js';
import { BoardStore } from '../src/boards/store.js';
import { BrandStore } from '../src/brands/store.js';
import { ProcessStore } from '../src/process/store.js';
import { AutomationRepository } from '../src/automation/repository.js';
import { readExportSnapshot } from '../src/exports/snapshot.js';

const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});
const pin = (asset: C.Asset) => ({
  assetId: asset.id,
  versionId: asset.currentVersionId,
});
const dependency = (
  asset: C.Asset,
  ...reasons: C.ExportDependencyReason[]
) => ({
  assetId: asset.id,
  reasons: reasons.sort(),
});
const sorted = <T extends { assetId: string }>(values: T[]) =>
  values.sort((a, b) => a.assetId.localeCompare(b.assetId));

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'cura-preview-snapshot-'));
  const database = openDatabase(
    resolveUserPaths({
      CURA_DATA_DIR: join(directory, 'data'),
      CURA_CACHE_DIR: join(directory, 'cache'),
      CURA_LOG_DIR: join(directory, 'logs'),
    }),
  );
  cleanups.push(
    () => rm(directory, { recursive: true, force: true }),
    () => database.close(),
  );
  const catalog = new CatalogStore(database);
  const library = catalog.createLibrary({ name: 'Dependency preview' });
  const root = catalog.addRoot(library.id, directory);
  const boards = new BoardStore(database);
  let jobOrder = 0;
  return {
    database,
    catalog,
    library,
    boards,
    asset(name: string) {
      const hash = createHash('sha256').update(name).digest('hex');
      return catalog.ingest({
        libraryId: library.id,
        rootId: root.id,
        relativePath: `${name}.png`,
        actualRelativePath: `${name}.png`,
        processed: {
          hash,
          size: 42,
          type: 'image/png',
          width: 32,
          height: 24,
          colors: [],
          phash: '',
          exif: {},
          generation: {
            prompt: '',
            negativePrompt: '',
            model: '',
            seed: '',
            source: '',
            params: {},
          },
          snapshotPath: join(directory, hash),
          thumbnailPath: null,
        },
      }).asset;
    },
    boardItems(assets: C.Asset[]) {
      const board = boards.createBoard(library.id, { name: 'Pinned' });
      return boards.saveLayout(board.board.id, {
        expectedRevision: 0,
        items: assets.map((asset) => ({
          id: randomUUID(),
          kind: 'asset' as const,
          ...pin(asset),
          x: 0,
          y: 0,
          width: 240,
          height: 180,
          groupId: null,
          label: '',
          text: '',
        })),
        edges: [],
      });
    },
    brand(assets: C.Asset[]) {
      const store = new BrandStore(database);
      const brand = store.createBrand(library.id, { name: 'Pinned brand' });
      store.saveBrand(brand.id, {
        expectedRevision: 0,
        name: brand.name,
        guidelines: '',
        colors: [],
        fonts: [],
        logos: assets.map((asset) => ({ name: asset.name, pin: pin(asset) })),
      });
    },
    automation(assets: C.Asset[]) {
      const date = new Date().toISOString();
      new AutomationRepository(database).put('automation_jobs', {
        id: randomUUID(),
        libraryId: library.id,
        kind: 'analysis',
        providerId: 'metadata-rules',
        status: 'completed',
        pins: assets.map(pin),
        total: assets.length,
        processed: assets.length,
        results: [],
        errorCode: null,
        ruleId: null,
        scriptId: null,
        createdAt: date,
        updatedAt: date,
      });
    },
    fcpxml(assets: C.Asset[]) {
      const date = new Date().toISOString();
      const job = C.FcpxmlJobSchema.parse({
        id: randomUUID(),
        libraryId: library.id,
        status: 'completed',
        progress: 1,
        request: {
          name: 'Exact historical clips',
          clips: assets.map((asset) => ({
            id: randomUUID(),
            ...pin(asset),
            durationFrames: 25,
          })),
        },
        filename: null,
        duration: '1s',
        bytes: 0,
        problems: [],
        error: null,
        createdAt: date,
        updatedAt: date,
      });
      database.sqlite
        .prepare('INSERT INTO fcpxml_jobs VALUES (?,?,?,NULL,?,?)')
        .run(job.id, library.id, JSON.stringify(job), date, date);
    },
    conflict(assetIds: string[]) {
      const date = new Date().toISOString();
      const linkId = randomUUID(),
        activityId = randomUUID();
      database.sqlite
        .prepare('INSERT INTO sync_links VALUES (?,?,?,?,NULL,?,?,?,?)')
        .run(
          linkId,
          library.id,
          randomUUID(),
          randomUUID(),
          '0',
          '{}',
          date,
          date,
        );
      const record = {
        kind: 'activity',
        id: activityId,
        libraryId: library.id,
        data: {
          id: activityId,
          libraryId: library.id,
          assetId: assetIds[0] ?? null,
          action: 'historical.reference',
          details: {
            nested: assetIds.map((assetId) => [
              { assetId },
              { kind: 'asset', id: assetId },
            ]),
          },
          createdAt: date,
          updatedAt: date,
        },
      };
      const conflict = C.SyncConflictDetailSchema.parse({
        id: randomUUID(),
        linkId,
        libraryId: library.id,
        entityKind: 'activity',
        entityId: activityId,
        resolution: 'local-wins',
        changedFields: [],
        base: null,
        local: record,
        remote: record,
        resolved: record,
        ordinalRemaps: [],
        createdAt: date,
        updatedAt: date,
      });
      database.sqlite
        .prepare('INSERT INTO sync_conflicts VALUES (?,?,?,?,?,?,?)')
        .run(
          conflict.id,
          linkId,
          'activity',
          activityId,
          JSON.stringify(conflict),
          date,
          date,
        );
    },
    similar(assetIds: string[]) {
      for (const assetId of assetIds) {
        // Historical weak references may survive after the referenced live asset is gone.
        const collection = catalog.createCollection(library.id, {
          name: `Similar ${assetId}`,
          rules: {},
        });
        database.sqlite
          .prepare('UPDATE collections SET rules=? WHERE id=?')
          .run(JSON.stringify({ similarTo: assetId }), collection.id);
      }
    },
    generation(assetIds: string[]) {
      const store = new ProcessStore(database);
      const job = store.createJob(library.id, { prompt: 'Shared provenance' });
      store.updateJob(job.id, { status: 'completed', progress: 1, assetIds });
      database.sqlite
        .prepare('UPDATE generation_jobs SET created_at=? WHERE id=?')
        .run(new Date(jobOrder++ * 1000).toISOString(), job.id);
      return job.id;
    },
    snapshot(assetIds: string[]) {
      return readExportSnapshot(database, library.id, {
        scope: 'selection',
        assetIds,
      });
    },
  };
}

test('records every actual closure edge and unions overlapping reasons without entering the manifest', async () => {
  const f = await fixture();
  const selected = f.asset('selected'),
    shared = f.asset('shared');
  const board = f.asset('board'),
    brand = f.asset('brand');
  const automation = f.asset('automation'),
    fcpxml = f.asset('fcpxml');
  const conflict = f.asset('conflict'),
    similar = f.asset('similar');
  const generated = f.asset('generated');
  f.boardItems([selected, shared, shared, board]);
  f.brand([selected, shared, brand]);
  f.automation([selected, shared, shared, automation]);
  f.fcpxml([selected, shared, fcpxml]);
  f.conflict([selected.id, shared.id, conflict.id]);
  f.similar([selected.id, shared.id, shared.id, similar.id]);
  f.generation([selected.id, shared.id, generated.id]);

  const snapshot = f.snapshot([selected.id, selected.id]);
  const expected = sorted([
    dependency(
      shared,
      'board',
      'brand',
      'automation',
      'fcpxml',
      'sync-conflict',
      'similar-to',
      'generation-output',
    ),
    dependency(board, 'board'),
    dependency(brand, 'brand'),
    dependency(automation, 'automation'),
    dependency(fcpxml, 'fcpxml'),
    dependency(conflict, 'sync-conflict'),
    dependency(similar, 'similar-to'),
    dependency(generated, 'generation-output'),
  ]);
  expect(snapshot.dependencies).toEqual(expected);
  expect(snapshot.manifest.requestedAssetIds).toEqual([selected.id]);
  expect([...snapshot.manifest.includedDependencyAssetIds].sort()).toEqual(
    expected.map((item) => item.assetId),
  );
  expect(snapshot.manifest.assets).toHaveLength(9);
  expect(snapshot.manifest).not.toHaveProperty('dependencies');
  expect(f.snapshot([selected.id]).dependencies).toEqual(expected);
});

test('board reasons retain free items, current pins and historical revisions exactly once', async () => {
  const f = await fixture();
  const selected = f.asset('selected'),
    item = f.asset('item');
  const historical = f.asset('historical'),
    current = f.asset('current');
  const board = f.boardItems([selected, item, item]);
  const withSlot = f.boards.createSlot(board.board.id, {
    expectedRevision: board.board.revision,
    label: 'Version history',
  });
  const slotId = withSlot.slots[0]!.id;
  f.boards.assignSlot(slotId, { expectedRevision: 0, pin: pin(historical) });
  f.boards.assignSlot(slotId, { expectedRevision: 1, pin: pin(current) });
  const snapshot = f.snapshot([selected.id]);
  expect(snapshot.dependencies).toEqual(
    sorted([
      dependency(item, 'board'),
      dependency(historical, 'board'),
      dependency(current, 'board'),
    ]),
  );
  expect(snapshot.manifest.assets).toHaveLength(4);
});

test('generation-output reasons follow transitive multi-output jobs without including disconnected jobs', async () => {
  const f = await fixture();
  const selected = f.asset('selected'),
    middle = f.asset('middle');
  const tail = f.asset('tail'),
    disconnected = f.asset('disconnected');
  const farJob = f.generation([middle.id, tail.id, tail.id]);
  const nearJob = f.generation([selected.id, middle.id]);
  f.generation([disconnected.id]);
  const snapshot = f.snapshot([selected.id]);
  expect(snapshot.dependencies).toEqual(
    sorted([
      dependency(middle, 'generation-output'),
      dependency(tail, 'generation-output'),
    ]),
  );
  expect(snapshot.manifest.assets.map((asset) => asset.id).sort()).toEqual(
    [selected.id, middle.id, tail.id].sort(),
  );
  expect(snapshot.manifest.process.jobs.map((job) => job.id)).toEqual([
    farJob,
    nearJob,
  ]);
});

test('missing weak references do not add dependency entries or inflate actual exported membership', async () => {
  const f = await fixture();
  const selected = f.asset('selected'),
    live = f.asset('live');
  const missing = randomUUID();
  f.similar([missing, live.id]);
  f.conflict([missing, live.id]);
  f.generation([selected.id, missing]);
  const snapshot = f.snapshot([selected.id]);
  expect(snapshot.dependencies).toEqual([
    dependency(live, 'similar-to', 'sync-conflict'),
  ]);
  expect(snapshot.manifest.includedDependencyAssetIds).toEqual([live.id]);
  expect(snapshot.manifest.assets).toHaveLength(2);
  expect(snapshot.manifest.versions).toHaveLength(2);
});

test('whole-library snapshots count every asset as requested and preserve the empty manifest request convention', async () => {
  const f = await fixture();
  const first = f.asset('first'),
    second = f.asset('second');
  f.boardItems([second]);
  f.generation([first.id, second.id]);
  const snapshot = readExportSnapshot(f.database, f.library.id, {
    scope: 'library',
  });
  expect(snapshot.dependencies).toEqual([]);
  expect(snapshot.manifest.requestedAssetIds).toEqual([]);
  expect(snapshot.manifest.includedDependencyAssetIds).toEqual([]);
  expect(snapshot.manifest.assets).toHaveLength(2);
});
