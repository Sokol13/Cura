import { createHash, randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  AssetPageSchema,
  AssetSchema,
  AssetVersionsSchema,
  LibrarySchema,
  ScanSummariesSchema,
} from '@cura/shared';
import { createApp } from '../src/app.js';
import { CatalogStore } from '../src/catalog-store.js';
import { openDatabase, type AppDatabase } from '../src/database.js';
import { processFile } from '../src/media/image.js';
import type { UserPaths } from '../src/paths.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.unstubAllEnvs();
});

const artwork = (color: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="${color}"/><circle cx="40" cy="30" r="15" fill="#ffffff"/></svg>`,
  );
const hash = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const localDay = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');

async function directories() {
  const directory = await mkdtemp(join(tmpdir(), 'cura-inbox-acceptance-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  return {
    directory,
    paths: {
      data: join(directory, 'data'),
      cache: join(directory, 'cache'),
      log: join(directory, 'log'),
    },
  };
}

async function start(paths: UserPaths) {
  const db = openDatabase(paths);
  const app = await createApp({ database: db, paths, staticRoot: false });
  const close = async () => {
    await app.close();
    if (db.sqlite.open) db.close();
  };
  cleanup.push(close);
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  return { db, url, close };
}

interface SourceRow {
  id: string;
  asset_id: string;
  root_id: string;
  relative_path: string;
  actual_relative_path: string;
  last_hash: string;
  created_at: string;
  available: number;
}
function sources(db: AppDatabase, rootId: string): SourceRow[] {
  return db.sqlite
    .prepare<
      [string],
      SourceRow
    >('SELECT id,asset_id,root_id,relative_path,actual_relative_path,last_hash,created_at,available FROM asset_sources WHERE root_id=? ORDER BY id')
    .all(rootId);
}
function versions(db: AppDatabase, assetId: string) {
  return db.sqlite
    .prepare('SELECT * FROM asset_versions WHERE asset_id=? ORDER BY ordinal')
    .all(assetId);
}

async function finishScan(url: string, libraryId: string, rootId: string) {
  expect(
    (
      await fetch(`${url}/api/libraries/${libraryId}/rescan`, {
        method: 'POST',
      })
    ).ok,
  ).toBe(true);
  await expect
    .poll(
      async () => {
        const response = await fetch(`${url}/api/libraries/${libraryId}/scans`);
        return ScanSummariesSchema.parse(await response.json()).find(
          (summary) => summary.rootId === rootId,
        )?.status;
      },
      { timeout: 5000 },
    )
    .toBe('completed');
}

it('uses local date folders and adds short collision suffixes without overwriting repeated or concurrent HTTP uploads', async () => {
  // Choose a different local day from UTC without changing application timers.
  const now = new Date();
  vi.stubEnv(
    'TZ',
    now.getUTCHours() < 11 ? 'Etc/GMT+12' : 'Pacific/Kiritimati',
  );
  expect(localDay(now)).not.toBe(now.toISOString().slice(0, 10));
  const { directory, paths } = await directories();
  const original = join(directory, '中文设计.svg');
  const firstBytes = artwork('#c8643a');
  await writeFile(original, firstBytes);
  const { db, url } = await start(paths);
  const created = await fetch(`${url}/api/libraries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Dated upload acceptance' }),
  });
  expect(created.status).toBe(201);
  const library = LibrarySchema.parse(await created.json());
  const upload = async (bytes: Buffer) => {
    const response = await fetch(
      `${url}/api/libraries/${library.id}/upload?name=${encodeURIComponent('中文设计.svg')}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(bytes),
      },
    );
    expect(response.status).toBe(201);
    return AssetSchema.parse(await response.json());
  };
  const before = localDay(new Date());
  const first = await upload(await readFile(original));
  const day = first.relativePath.split('/')[0];
  expect([before, localDay(new Date())]).toContain(day);
  expect(first.relativePath).toBe(`${day}/中文设计.svg`);
  const secondBytes = artwork('#315aa2');
  const thirdBytes = artwork('#3f8159');
  const [second, repeated, third] = await Promise.all([
    upload(secondBytes),
    upload(firstBytes),
    upload(thirdBytes),
  ]);
  expect(new Set([first.id, second.id, third.id]).size).toBe(3);
  expect(repeated.id).toBe(first.id);
  const store = new CatalogStore(db);
  const root = store.getRoot(first.rootId);
  expect(root.kind).toBe('inbox');
  const aliases = sources(db, root.id);
  expect(aliases).toHaveLength(4);
  expect(new Set(aliases.map((source) => source.relative_path)).size).toBe(4);
  for (const source of aliases) {
    expect(source.relative_path.split('/')).toHaveLength(2);
    expect([before, localDay(new Date())]).toContain(
      source.relative_path.split('/')[0],
    );
    const name = basename(source.relative_path);
    if (name !== '中文设计.svg')
      expect(name).toMatch(/^中文设计-[a-f\d]{8}\.svg$/);
    expect(
      hash(await readFile(join(root.path, source.actual_relative_path))),
    ).toBe(source.last_hash);
  }
  expect(aliases.map((source) => source.last_hash).sort()).toEqual(
    [
      hash(firstBytes),
      hash(firstBytes),
      hash(secondBytes),
      hash(thirdBytes),
    ].sort(),
  );
  expect((await readdir(root.path)).sort()).toEqual(
    [
      ...new Set(aliases.map((source) => source.relative_path.split('/')[0])),
    ].sort(),
  );
  expect(await readFile(join(root.path, first.relativePath))).toEqual(
    firstBytes,
  );
  expect(await readFile(original)).toEqual(firstBytes);
  for (const asset of [first, second, third]) {
    const versionResponse = await fetch(
      `${url}/api/assets/${asset.id}/versions`,
    );
    expect(
      AssetVersionsSchema.parse(await versionResponse.json()),
    ).toHaveLength(1);
  }
}, 20_000);

it('migrates legacy UUID aliases by their local creation date without changing manual V2, version rows or retained bytes across restarts', async () => {
  vi.stubEnv('TZ', 'Pacific/Honolulu');
  const { directory, paths } = await directories();
  const db = openDatabase(paths);
  cleanup.push(async () => {
    if (db.sqlite.open) db.close();
  });
  const store = new CatalogStore(db);
  const library = store.createLibrary({ name: 'Legacy Inbox upgrade' });
  const rootPath = join(paths.data, 'libraries', library.id, 'Inbox');
  await mkdir(rootPath, { recursive: true });
  const root = store.addRoot(library.id, rootPath, 'inbox');
  const oldPaths = [
    `${randomUUID()}/设计原稿.svg`,
    `${randomUUID()}/设计原稿.svg`,
  ];
  const firstBytes = artwork('#c8643a');
  const original = join(directory, 'untouched-original.svg');
  await writeFile(original, firstBytes);
  let assetId = '';
  for (const [index, relativePath] of oldPaths.entries()) {
    const filePath = join(root.path, relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, firstBytes);
    const { asset } = store.ingest({
      libraryId: library.id,
      rootId: root.id,
      relativePath,
      // Windows historically persisted native separators in the actual locator.
      actualRelativePath:
        index === 1 ? relativePath.replaceAll('/', '\\') : relativePath,
      processed: await processFile({
        filePath,
        dataDir: paths.data,
        cacheDir: paths.cache,
      }),
    });
    if (assetId) expect(asset.id).toBe(assetId);
    assetId = asset.id;
  }
  const timestamps = ['2021-02-03T01:30:00.000Z', '2021-02-04T20:00:00.000Z'];
  for (const [index, relativePath] of oldPaths.entries()) {
    db.sqlite
      .prepare(
        'UPDATE asset_sources SET created_at=? WHERE root_id=? AND relative_path=?',
      )
      .run(timestamps[index], root.id, relativePath);
  }
  const manualFile = join(directory, '手工V2.svg');
  const secondBytes = artwork('#315aa2');
  await writeFile(manualFile, secondBytes);
  store.replaceAsset(
    assetId,
    await processFile({
      filePath: manualFile,
      dataDir: paths.data,
      cacheDir: paths.cache,
    }),
    '手工V2.svg',
  );
  const beforeAsset = store.updateAsset(assetId, {
    note: 'Keep manual V2 and both original aliases',
    rating: 4,
  });
  const beforeSources = sources(db, root.id);
  const beforeVersions = versions(db, assetId);
  expect(beforeVersions).toHaveLength(2);
  expect(beforeAsset.hash).toBe(hash(secondBytes));
  expect(beforeSources.map((source) => source.last_hash)).toEqual([
    hash(firstBytes),
    hash(firstBytes),
  ]);
  const retained = await Promise.all(
    store.listAllVersions().map(async (version) => ({
      path: version.snapshotPath,
      hash: hash(await readFile(version.snapshotPath)),
    })),
  );
  db.close();

  const server = await start(paths);
  const expectedPaths = ['2021-02-02/设计原稿.svg', '2021-02-04/设计原稿.svg'];
  await expect
    .poll(
      () =>
        sources(server.db, root.id)
          .map((source) => source.relative_path)
          .sort(),
      { timeout: 5000 },
    )
    .toEqual(expectedPaths);
  // Locator publication can precede verified source cleanup during startup.
  await expect
    .poll(async () => (await readdir(root.path)).sort(), { timeout: 5000 })
    .toEqual(['2021-02-02', '2021-02-04']);
  await finishScan(server.url, library.id, root.id);
  const afterSources = sources(server.db, root.id);
  expect(afterSources).toEqual(
    beforeSources.map((source) => {
      const migratedPath = `${localDay(new Date(source.created_at))}/设计原稿.svg`;
      return {
        ...source,
        relative_path: migratedPath,
        actual_relative_path: migratedPath,
      };
    }),
  );
  const afterAsset = AssetSchema.parse(
    await (await fetch(`${server.url}/api/assets/${assetId}`)).json(),
  );
  expect(afterAsset).toEqual({
    ...beforeAsset,
    relativePath: expectedPaths[0],
  });
  expect(versions(server.db, assetId)).toEqual(beforeVersions);
  for (const source of afterSources)
    expect(
      await readFile(join(root.path, source.actual_relative_path)),
    ).toEqual(firstBytes);
  for (const relativePath of oldPaths)
    await expect(readFile(join(root.path, relativePath))).rejects.toMatchObject(
      { code: 'ENOENT' },
    );
  for (const snapshot of retained)
    expect(hash(await readFile(snapshot.path))).toBe(snapshot.hash);
  const found = await fetch(
    `${server.url}/api/libraries/${library.id}/assets?q=2021-02-02`,
  );
  expect(
    AssetPageSchema.parse(await found.json()).items.map((asset) => asset.id),
  ).toContain(assetId);
  await server.close();

  const reopened = await start(paths);
  await finishScan(reopened.url, library.id, root.id);
  expect(sources(reopened.db, root.id)).toEqual(afterSources);
  expect(versions(reopened.db, assetId)).toEqual(beforeVersions);
  expect(
    AssetSchema.parse(
      await (await fetch(`${reopened.url}/api/assets/${assetId}`)).json(),
    ),
  ).toEqual(afterAsset);
  for (const snapshot of retained)
    expect(hash(await readFile(snapshot.path))).toBe(snapshot.hash);
  expect(await readFile(original)).toEqual(firstBytes);
  expect(await readFile(manualFile)).toEqual(secondBytes);
  expect(reopened.db.sqlite.pragma('integrity_check', { simple: true })).toBe(
    'ok',
  );
  expect(reopened.db.sqlite.pragma('foreign_key_check')).toEqual([]);
}, 20_000);
