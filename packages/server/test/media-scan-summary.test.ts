import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, expect, it } from 'vitest';
import {
  CatalogEventSchema,
  ScanSummariesSchema,
  type CatalogEvent,
  type ScanSummary,
} from '@cura/shared';
import { CatalogStore } from '../src/catalog-store.js';
import { registerCatalogRoutes } from '../src/catalog-routes.js';
import { openDatabase } from '../src/database.js';
import { processFile } from '../src/media/image.js';
import { MediaService } from '../src/media/service.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

const svg = (color: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><rect width="12" height="8" fill="${color}"/></svg>`,
  );
const hash = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'cura-scan-summary-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const paths = {
    data: join(directory, 'data'),
    cache: join(directory, 'cache'),
    log: join(directory, 'log'),
  };
  let database = openDatabase(paths);
  let store = new CatalogStore(database);
  let media = new MediaService(store, paths);
  async function createApp() {
    const server = Fastify();
    await registerCatalogRoutes(server, store, media, paths);
    server.addHook('onClose', () => media.close());
    return server;
  }
  let app = await createApp();
  cleanup.push(async () => {
    await app.close();
    database.close();
  });
  const library = store.createLibrary({ name: 'Recursive scan acceptance' });
  const folder = join(directory, 'source');
  await mkdir(folder);
  return {
    directory,
    paths,
    library,
    folder,
    get app() {
      return app;
    },
    get store() {
      return store;
    },
    get media() {
      return media;
    },
    async reopen(whileClosed?: () => Promise<void>) {
      await app.close();
      await whileClosed?.();
      database.close();
      database = openDatabase(paths);
      store = new CatalogStore(database);
      media = new MediaService(store, paths);
      app = await createApp();
    },
  };
}

async function summaries(app: FastifyInstance, libraryId: string) {
  const response = await app.inject(`/api/libraries/${libraryId}/scans`);
  expect(response.statusCode).toBe(200);
  return ScanSummariesSchema.parse(response.json());
}

async function finished(
  app: FastifyInstance,
  libraryId: string,
  rootId: string,
  previousScanId?: string,
): Promise<ScanSummary> {
  let result: ScanSummary | undefined;
  await expect
    .poll(
      async () => {
        result = (await summaries(app, libraryId)).find(
          (scan) => scan.rootId === rootId,
        );
        return Boolean(
          result &&
            result.scanId !== previousScanId &&
            result.status !== 'running',
        );
      },
      { timeout: 5_000 },
    )
    .toBe(true);
  return result!;
}

it('counts recursive supported and skipped files independently of deduplicated assets', async () => {
  const f = await fixture();
  const nested = join(f.folder, '子目录', 'nested');
  await mkdir(nested, { recursive: true });
  const picture = svg('red');
  const archive = Buffer.from(
    'An archive is not an automatically imported visual asset.',
  );
  await Promise.all([
    writeFile(join(f.folder, 'design.SVG'), picture),
    writeFile(join(nested, 'same-bytes.svg'), picture),
    writeFile(join(nested, 'font.woff2'), Buffer.from('wOF2-test-font')),
    writeFile(join(f.folder, 'backup.ZIP'), archive),
    writeFile(join(nested, 'notes.txt'), 'Skipped text'),
    writeFile(join(nested, 'README'), 'Skipped extensionless file'),
  ]);
  const root = await f.media.registerRoot(f.library.id, f.folder);
  const summary = await finished(f.app, f.library.id, root.id);
  expect(summary).toMatchObject({
    rootId: root.id,
    libraryId: f.library.id,
    status: 'completed',
    phase: 'finished',
    recursive: true,
    filesFound: 6,
    supportedFound: 3,
    existingGenericFound: 0,
    unsupportedSkipped: 3,
    processed: 3,
    succeeded: 3,
    readErrors: 0,
    errors: [],
  });
  expect(summary.extensions).toEqual(
    expect.arrayContaining([
      {
        extension: '.svg',
        found: 2,
        supported: 2,
        existingGeneric: 0,
        skipped: 0,
        readErrors: 0,
      },
      {
        extension: '.woff2',
        found: 1,
        supported: 1,
        existingGeneric: 0,
        skipped: 0,
        readErrors: 0,
      },
      {
        extension: '.zip',
        found: 1,
        supported: 0,
        existingGeneric: 0,
        skipped: 1,
        readErrors: 0,
      },
      {
        extension: '.txt',
        found: 1,
        supported: 0,
        existingGeneric: 0,
        skipped: 1,
        readErrors: 0,
      },
      {
        extension: '',
        found: 1,
        supported: 0,
        existingGeneric: 0,
        skipped: 1,
        readErrors: 0,
      },
    ]),
  );
  expect(f.store.listAssets(f.library.id).total).toBe(2);
  const first = f.store.getSource(root.id, 'design.SVG');
  expect(first).toBeDefined();
  expect(
    f.store.getSource(root.id, '子目录/nested/same-bytes.svg')?.assetId,
  ).toBe(first?.assetId);
  expect(f.store.getSource(root.id, 'backup.ZIP')).toBeUndefined();
  expect(await readdir(join(f.paths.data, 'objects'))).not.toContain(
    hash(archive),
  );
  expect(await readFile(join(f.folder, 'backup.ZIP'))).toEqual(archive);
}, 15_000);

it('finishes an empty scan at zero and emits a terminal summary instead of leaving 0 / 0 running', async () => {
  const f = await fixture();
  const events: CatalogEvent[] = [];
  f.media.subscribe((event) => events.push(CatalogEventSchema.parse(event)));
  const root = await f.media.registerRoot(f.library.id, f.folder);
  const summary = await finished(f.app, f.library.id, root.id);
  expect(summary).toMatchObject({
    status: 'completed',
    phase: 'finished',
    filesFound: 0,
    supportedFound: 0,
    unsupportedSkipped: 0,
    processed: 0,
    succeeded: 0,
    readErrors: 0,
    extensions: [],
    errors: [],
  });
  expect(summary.finishedAt).not.toBeNull();
  const scans = events.filter(
    (event) => event.type === 'scan' && event.rootId === root.id,
  );
  expect(scans.some((event) => event.scanSummary?.status === 'running')).toBe(
    true,
  );
  expect(scans.at(-1)).toMatchObject({
    completed: 0,
    total: 0,
    scanSummary: summary,
  });
}, 15_000);

it('persists the latest summary across reopening and scopes the API to one existing library', async () => {
  const f = await fixture();
  await writeFile(join(f.folder, 'ignored.txt'), 'No supported files here.');
  const root = await f.media.registerRoot(f.library.id, f.folder);
  const first = await finished(f.app, f.library.id, root.id);
  await writeFile(join(f.folder, 'nested.svg'), svg('blue'));
  await expect.poll(() => f.store.listAssets(f.library.id).total).toBe(1);
  await f.media.rescan(f.library.id);
  const latest = await finished(f.app, f.library.id, root.id, first.scanId);
  expect(latest).toMatchObject({
    supportedFound: 1,
    unsupportedSkipped: 1,
    status: 'completed',
  });
  const other = f.store.createLibrary({ name: 'Independent library' });
  expect(await summaries(f.app, other.id)).toEqual([]);
  expect(
    (await f.app.inject(`/api/libraries/${randomUUID()}/scans`)).statusCode,
  ).toBe(404);
  await f.reopen();
  expect(await summaries(f.app, f.library.id)).toEqual([latest]);
  expect(await summaries(f.app, other.id)).toEqual([]);
}, 15_000);

it('keeps grandfathered generic sources and their watched versions while skipping new unknown files', async () => {
  const f = await fixture();
  const legacyPath = join(f.folder, 'legacy.bin');
  const legacyBytes = Buffer.from('Existing generic version one');
  await Promise.all([
    writeFile(legacyPath, legacyBytes),
    writeFile(join(f.folder, 'known.svg'), svg('red')),
    writeFile(join(f.folder, 'new.zip'), 'A new unsupported file'),
  ]);
  const root = f.store.addRoot(f.library.id, f.folder);
  const legacy = f.store.ingest({
    libraryId: f.library.id,
    rootId: root.id,
    relativePath: 'legacy.bin',
    actualRelativePath: 'legacy.bin',
    processed: await processFile({
      filePath: legacyPath,
      dataDir: f.paths.data,
      cacheDir: f.paths.cache,
    }),
  }).asset;
  await f.media.resume();
  const first = await finished(f.app, f.library.id, root.id);
  expect(first).toMatchObject({
    filesFound: 3,
    supportedFound: 1,
    existingGenericFound: 1,
    unsupportedSkipped: 1,
    succeeded: 2,
  });
  expect(f.store.listVersions(legacy.id)).toHaveLength(1);
  const known = f.store.getSource(root.id, 'known.svg')!;
  await Promise.all([
    writeFile(legacyPath, 'Existing generic version two'),
    writeFile(join(f.folder, 'known.svg'), svg('blue')),
    writeFile(
      join(f.folder, 'watched.zip'),
      'This new file must also be skipped',
    ),
  ]);
  await expect
    .poll(() => f.store.listVersions(legacy.id).length, { timeout: 4_500 })
    .toBe(2);
  await expect
    .poll(() => f.store.listVersions(known.assetId).length, { timeout: 4_500 })
    .toBe(2);
  expect(f.store.getSource(root.id, 'watched.zip')).toBeUndefined();
  expect(f.store.listAssets(f.library.id).total).toBe(2);
  await f.media.rescan(f.library.id);
  const latest = await finished(f.app, f.library.id, root.id, first.scanId);
  expect(latest).toMatchObject({
    filesFound: 4,
    supportedFound: 1,
    existingGenericFound: 1,
    unsupportedSkipped: 2,
    succeeded: 2,
  });
  const retained = f.store
    .listVersions(legacy.id)
    .find((version) => version.hash === hash(legacyBytes))!;
  expect(
    await readFile(f.store.getVersionFile(retained.id).snapshotPath),
  ).toEqual(legacyBytes);
  const uploaded = await f.media.upload(
    f.library.id,
    'manual.txt',
    Buffer.from('Manual import remains available.'),
  );
  expect(uploaded.name).toBe('manual.txt');
  expect(f.store.listAssets(f.library.id).total).toBe(3);
}, 20_000);

it.each(['missing', 'replaced'] as const)(
  'records a failed startup scan when a registered root is %s',
  async (condition) => {
    const f = await fixture();
    await writeFile(join(f.folder, 'retained.svg'), svg('orange'));
    const root = await f.media.registerRoot(f.library.id, f.folder);
    const first = await finished(f.app, f.library.id, root.id);
    const asset = f.store.listAssets(f.library.id).items[0]!;
    await f.reopen(async () => {
      await rename(f.folder, join(f.directory, 'moved-source'));
      if (condition === 'replaced')
        await writeFile(f.folder, 'A regular file replaced this directory.');
    });
    await f.media.resume();
    const failed = await finished(f.app, f.library.id, root.id, first.scanId);
    expect(failed).toMatchObject({
      status: 'failed',
      phase: 'finished',
      filesFound: 0,
      processed: 0,
      succeeded: 0,
      readErrors: 1,
      errors: [
        {
          relativePath: null,
          stage: 'enumerate',
          code: condition === 'missing' ? 'ENOENT' : 'ENOTDIR',
        },
      ],
    });
    expect(JSON.stringify(failed)).not.toContain(f.directory);
    expect(f.store.getAsset(asset.id).missing).toBe(true);
    expect(f.store.listVersions(asset.id)).toHaveLength(1);
    expect(
      await readFile(
        f.store.getVersionFile(asset.currentVersionId).snapshotPath,
      ),
    ).toEqual(svg('orange'));
  },
  15_000,
);
