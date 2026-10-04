import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, test } from 'vitest';
import { openDatabase } from '../src/database.js';
import { resolveUserPaths } from '../src/paths.js';
import { CatalogStore, type IngestedFile } from '../src/catalog-store.js';
import { ProcessStore } from '../src/process/store.js';
import { setFinalSelection } from '../src/process/final-selections.js';

const cleanups: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});
const file = (
  hash: string,
  model = ' Flux ',
  source = 'ComfyUI',
): IngestedFile => ({
  hash,
  size: 12,
  type: 'image/png',
  width: 12,
  height: 8,
  colors: ['#ff0000'],
  phash: '0000000000000000',
  exif: {},
  generation: {
    prompt: `scene ${hash}`,
    negativePrompt: '',
    model,
    source,
    seed: '18446744073709551615',
    params: {},
  },
  snapshotPath: `/private/${hash}`,
  thumbnailPath: null,
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'cura-process-store-'));
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
  const process = new ProcessStore(database);
  const library = catalog.createLibrary({ name: 'Process' });
  const root = catalog.addRoot(library.id, directory);
  const ingest = (name: string, hash: string) =>
    catalog.ingest({
      libraryId: library.id,
      rootId: root.id,
      relativePath: name,
      actualRelativePath: name,
      processed: file(hash),
    }).asset;
  return { database, catalog, process, library, ingest };
}

test('recorded output identities survive fork clones and keep distinct statistics', async () => {
  const f = await fixture();
  const original = f.ingest('one.png', 'one');
  expect(original.generationId).toMatch(/^[a-f\d-]{36}$/);
  f.ingest('alias.png', 'one');
  const fork = f.ingest('alias.png', 'two');
  const versions = f.catalog.listVersions(fork.id);
  expect(versions.find((version) => version.ordinal === 1)?.generationId).toBe(
    original.generationId,
  );
  expect(
    versions.find((version) => version.ordinal === 2)?.generationId,
  ).not.toBe(original.generationId);
  expect(f.process.statistics(f.library.id)).toMatchObject({
    outputs: 2,
    selectedOutputs: 0,
    hitRate: 0,
    models: [{ key: 'flux', outputs: 2, selectedOutputs: 0 }],
    sources: [{ key: 'comfyui', outputs: 2 }],
  });
  const originalPin = {
    assetId: original.id,
    versionId: original.currentVersionId,
  };
  setFinalSelection(
    f.database,
    { libraryId: f.library.id, ownerKind: 'slot', ownerId: randomUUID() },
    originalPin,
  );
  setFinalSelection(
    f.database,
    { libraryId: f.library.id, ownerKind: 'slot', ownerId: randomUUID() },
    originalPin,
  );
  f.catalog.updateAsset(original.id, { finalized: true });
  expect(f.process.statistics(f.library.id)).toMatchObject({
    outputs: 2,
    selectedOutputs: 1,
    hitRate: 0.5,
  });
});

test('manual finalization is version-specific and replacement cannot inherit a stale final pin', async () => {
  const f = await fixture();
  const asset = f.ingest('scene.png', 'one');
  f.catalog.updateAsset(asset.id, { finalized: true });
  const replaced = f.catalog.replaceAsset(
    asset.id,
    file('two'),
    'replacement.png',
  );
  expect(replaced.finalized).toBe(false);
  let timeline = f.process.timeline(asset.id);
  expect(timeline.entries.map((entry) => entry.finalSelections.length)).toEqual(
    [1, 0],
  );
  f.catalog.updateAsset(asset.id, { finalized: true });
  timeline = f.process.timeline(asset.id);
  expect(timeline.entries.map((entry) => entry.finalSelections.length)).toEqual(
    [0, 1],
  );
  f.catalog.updateAsset(asset.id, { finalized: false });
  expect(f.process.statistics(f.library.id)).toMatchObject({
    outputs: 2,
    selectedOutputs: 0,
  });
});

test('timeline metadata edits update canonical model/source grouping and empty libraries avoid NaN', async () => {
  const f = await fixture();
  expect(f.process.statistics(f.library.id)).toMatchObject({
    outputs: 0,
    selectedOutputs: 0,
    hitRate: 0,
    sources: [],
    models: [],
  });
  const asset = f.ingest('scene.png', 'one');
  f.catalog.updateAsset(asset.id, {
    prompt: 'Revised scene',
    model: ' ',
    source: '',
    seed: '18446744073709551615',
  });
  const entry = f.process.timeline(asset.id).entries[0]!;
  expect(entry.version.prompt).toBe('Revised scene');
  expect(entry.version.seed).toBe('18446744073709551615');
  expect(f.process.statistics(f.library.id)).toMatchObject({
    models: [{ key: '', outputs: 1 }],
    sources: [{ key: '', outputs: 1 }],
  });
});
