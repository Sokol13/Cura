import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/database.js';
import { resolveUserPaths } from '../src/paths.js';
import { CatalogStore, type IngestedFile } from '../src/catalog-store.js';
import { setFinalSelection } from '../src/process/final-selections.js';

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const dispose of cleanup.reverse()) await dispose();
  cleanup.length = 0;
});
const file = (hash: string): IngestedFile => ({
  hash,
  size: 12,
  type: 'image/png',
  width: 10,
  height: 10,
  colors: ['#ff0000'],
  phash: '0000000000000000',
  exif: {},
  generation: {
    prompt: 'A scene',
    negativePrompt: '',
    source: 'ComfyUI',
    model: 'Flux',
    seed: '18446744073709551615',
    params: {},
  },
  snapshotPath: `/private/${hash}`,
  thumbnailPath: null,
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'cura-process-owner-'));
  const database = openDatabase(
    resolveUserPaths({
      CURA_DATA_DIR: join(directory, 'data'),
      CURA_CACHE_DIR: join(directory, 'cache'),
      CURA_LOG_DIR: join(directory, 'logs'),
    }),
  );
  cleanup.push(
    () => rm(directory, { recursive: true, force: true }),
    () => database.close(),
  );
  if (
    !database.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE name='final_selections'")
      .get()
  )
    database.sqlite.exec(
      readFileSync(
        new URL('../drizzle/0003_process.sql', import.meta.url),
        'utf8',
      ),
    );
  const store = new CatalogStore(database);
  const library = store.createLibrary({ name: 'Process' });
  const root = store.addRoot(library.id, directory);
  const ingest = (name: string, hash: string) =>
    store.ingest({
      libraryId: library.id,
      rootId: root.id,
      relativePath: name,
      actualRelativePath: name,
      processed: file(hash),
    }).asset;
  return { database, store, library, ingest };
}

describe('final selection owners', () => {
  it('keeps manual and independent slot owners without inflating same-pin selections', async () => {
    const f = await fixture();
    const asset = f.ingest('one.png', 'one');
    const manual = {
      libraryId: f.library.id,
      ownerKind: 'manual' as const,
      ownerId: asset.id,
    };
    const slot = {
      ...manual,
      ownerKind: 'slot' as const,
      ownerId: randomUUID(),
    };
    const pin = { assetId: asset.id, versionId: asset.currentVersionId };
    setFinalSelection(f.database, manual, pin);
    setFinalSelection(f.database, slot, pin);
    expect(f.store.getAsset(asset.id).finalized).toBe(true);
    const before = f.database.sqlite
      .prepare('SELECT * FROM final_selections ORDER BY id')
      .all();
    setFinalSelection(f.database, slot, pin);
    expect(
      f.database.sqlite
        .prepare('SELECT * FROM final_selections ORDER BY id')
        .all(),
    ).toEqual(before);
    setFinalSelection(f.database, manual, null);
    expect(f.store.getAsset(asset.id).finalized).toBe(true);
    setFinalSelection(f.database.sqlite, slot, null);
    expect(f.store.getAsset(asset.id).finalized).toBe(false);
  });

  it('replaces only the owner pin and participates in the caller transaction', async () => {
    const f = await fixture();
    const first = f.ingest('first.png', 'one');
    const second = f.ingest('second.png', 'two');
    const owner = {
      libraryId: f.library.id,
      ownerKind: 'slot' as const,
      ownerId: randomUUID(),
    };
    setFinalSelection(f.database, owner, {
      assetId: first.id,
      versionId: first.currentVersionId,
    });
    const before = f.database.sqlite
      .prepare('SELECT id,created_at FROM final_selections')
      .get();
    expect(() =>
      f.database.sqlite.transaction(() => {
        setFinalSelection(f.database, owner, {
          assetId: second.id,
          versionId: second.currentVersionId,
        });
        throw new Error('Board revision conflict');
      })(),
    ).toThrow('Board revision conflict');
    expect(f.store.getAsset(first.id).finalized).toBe(true);
    expect(f.store.getAsset(second.id).finalized).toBe(false);
    setFinalSelection(f.database, owner, {
      assetId: second.id,
      versionId: second.currentVersionId,
    });
    expect(
      f.database.sqlite
        .prepare('SELECT id,created_at FROM final_selections')
        .get(),
    ).toEqual(before);
    expect(f.store.getAsset(first.id).finalized).toBe(false);
    expect(f.store.getAsset(second.id).finalized).toBe(true);
  });

  it('rejects cross-library/version pins and manual owners belonging to another asset', async () => {
    const f = await fixture();
    const first = f.ingest('one.png', 'one');
    const second = f.ingest('two.png', 'two');
    const elsewhere = f.store.createLibrary({ name: 'Elsewhere' });
    expect(() =>
      setFinalSelection(
        f.database,
        { libraryId: elsewhere.id, ownerKind: 'slot', ownerId: randomUUID() },
        { assetId: first.id, versionId: first.currentVersionId },
      ),
    ).toThrow(/library/i);
    expect(() =>
      setFinalSelection(
        f.database,
        { libraryId: f.library.id, ownerKind: 'slot', ownerId: randomUUID() },
        { assetId: first.id, versionId: second.currentVersionId },
      ),
    ).toThrow(/version/i);
    expect(() =>
      setFinalSelection(
        f.database,
        { libraryId: f.library.id, ownerKind: 'manual', ownerId: second.id },
        { assetId: first.id, versionId: first.currentVersionId },
      ),
    ).toThrow(/manual/i);
    expect(
      f.database.sqlite.prepare('SELECT * FROM final_selections').all(),
    ).toEqual([]);
  });
});
