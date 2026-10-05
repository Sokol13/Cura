import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import {
  ExportPreviewSchema,
  ExportManifestSchema,
  ExportJobSchema,
  type Asset,
  type BoardItemInput,
} from '@cura/shared';
import { openDatabase } from '../src/database.js';
import { CatalogStore } from '../src/catalog-store.js';
import { BoardStore } from '../src/boards/store.js';
import { BrandStore } from '../src/brands/store.js';
import { ExportService } from '../src/exports/service.js';
import { createApp } from '../src/app.js';
const cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'cura-export-preview-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const paths = {
    data: join(directory, 'data'),
    cache: join(directory, 'cache'),
    log: join(directory, 'log'),
  };
  const database = openDatabase(paths);
  cleanup.push(() => database.close());
  const catalog = new CatalogStore(database),
    boards = new BoardStore(database),
    brands = new BrandStore(database),
    service = new ExportService(database, paths);
  cleanup.push(() => service.close());
  const library = catalog.createLibrary({ name: 'Preview' });
  const originals = join(directory, 'originals');
  await mkdir(originals);
  const root = catalog.addRoot(library.id, originals);
  const processed = async (name: string) => {
    const bytes = Buffer.from(name),
      hash = createHash('sha256').update(bytes).digest('hex');
    const snapshotPath = join(paths.data, hash);
    await writeFile(snapshotPath, bytes);
    return {
      hash,
      size: bytes.length,
      type: 'application/octet-stream',
      width: null,
      height: null,
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
      snapshotPath,
      thumbnailPath: null,
    };
  };
  const assets: Asset[] = [];
  for (const name of [
    'chosen',
    'board-dependency',
    'replacement',
    'other-chosen',
  ])
    assets.push(
      catalog.ingest({
        libraryId: library.id,
        rootId: root.id,
        relativePath: `${name}.bin`,
        actualRelativePath: `${name}.bin`,
        processed: await processed(name),
      }).asset,
    );
  const board = boards.createBoard(library.id, { name: 'Dependency board' }),
    itemId = randomUUID();
  const boardPin = (asset: Asset) => {
    const current = boards.getBoard(board.board.id);
    const item: BoardItemInput = {
      id: itemId,
      kind: 'asset',
      assetId: asset.id,
      versionId: asset.currentVersionId,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      groupId: null,
      label: '',
      text: '',
    };
    boards.saveLayout(board.board.id, {
      expectedRevision: current.board.revision,
      items: [item],
      edges: [],
    });
  };
  boardPin(assets[1]!);
  let brandId: string | undefined;
  const brandPin = (asset: Asset) => {
    brandId ??= brands.createBrand(library.id, { name: 'Dependency brand' }).id;
    const brand = brands.getBrand(brandId);
    brands.saveBrand(brandId, {
      expectedRevision: brand.revision,
      name: brand.name,
      guidelines: '',
      colors: [],
      fonts: [],
      logos: [
        {
          name: 'Logo',
          pin: { assetId: asset.id, versionId: asset.currentVersionId },
        },
      ],
    });
  };
  const request = { scope: 'selection' as const, assetIds: [assets[0]!.id] };
  const jobs = () =>
    database.sqlite.prepare('SELECT count(*) AS count FROM export_jobs').get();
  return {
    directory,
    paths,
    database,
    catalog,
    boards,
    brands,
    service,
    library,
    root,
    assets,
    processed,
    boardPin,
    brandPin,
    request,
    jobs,
  };
}
it('previews exact membership without creating jobs or changing database rows', async () => {
  const f = await fixture();
  f.brandPin(f.assets[1]!);
  const before = f.database.sqlite
    .prepare('SELECT total_changes() AS count')
    .get();
  const preview = ExportPreviewSchema.parse(
    f.service.preview(f.library.id, {
      ...f.request,
      assetIds: [...f.request.assetIds, ...f.request.assetIds],
    }),
  );
  expect(preview).toMatchObject({
    requestedAssetIds: f.request.assetIds,
    includedDependencyAssetIds: [f.assets[1]!.id],
    requestedAssetCount: 1,
    dependencyAssetCount: 1,
    totalAssetCount: 2,
    reasons: [
      { reason: 'board', count: 1 },
      { reason: 'brand', count: 1 },
    ],
  });
  expect(f.jobs()).toEqual({ count: 0 });
  expect(
    f.database.sqlite.prepare('SELECT total_changes() AS count').get(),
  ).toEqual(before);
  expect(await readdir(f.paths.data)).not.toContain('exports');
});
it('binds same-count dependency identities and per-asset reasons, rejecting stale confirmation before any job', async () => {
  const f = await fixture();
  let old = f.service.preview(f.library.id, f.request);
  f.boardPin(f.assets[2]!);
  expect(f.service.preview(f.library.id, f.request).dependencyAssetCount).toBe(
    old.dependencyAssetCount,
  );
  expect(() =>
    f.service.start(f.library.id, {
      ...f.request,
      expectedPreviewToken: old.previewToken,
    }),
  ).toThrowError(
    expect.objectContaining({ code: 'EXPORT_PREVIEW_STALE', statusCode: 409 }),
  );
  f.brandPin(f.assets[1]!);
  old = f.service.preview(f.library.id, f.request);
  f.boardPin(f.assets[1]!);
  f.brandPin(f.assets[2]!);
  const changed = f.service.preview(f.library.id, f.request);
  expect(changed.includedDependencyAssetIds).toEqual(
    old.includedDependencyAssetIds,
  );
  expect(changed.reasons).toEqual(old.reasons);
  expect(changed.previewToken).not.toBe(old.previewToken);
  expect(() =>
    f.service.start(f.library.id, {
      ...f.request,
      expectedPreviewToken: old.previewToken,
    }),
  ).toThrowError(expect.objectContaining({ code: 'EXPORT_PREVIEW_STALE' }));
  expect(f.jobs()).toEqual({ count: 0 });
  expect(await readdir(f.paths.data)).not.toContain('exports');
});
it('keeps tokens stable for order, duplicates, versions and unrelated metadata', async () => {
  const f = await fixture();
  const request = {
    ...f.request,
    assetIds: [f.assets[0]!.id, f.assets[3]!.id],
  };
  const before = f.service.preview(f.library.id, request);
  f.catalog.replaceAsset(
    f.assets[0]!.id,
    await f.processed('new bytes'),
    'new-version.bin',
  );
  f.catalog.updateAsset(f.assets[1]!.id, { note: 'Changed note' });
  f.catalog.createTag(f.library.id, { name: 'Unrelated tag' });
  expect(
    f.service.preview(f.library.id, {
      ...request,
      assetIds: [f.assets[3]!.id, f.assets[0]!.id, f.assets[3]!.id],
    }).previewToken,
  ).toBe(before.previewToken);
  expect(
    f.service.preview(f.library.id, { scope: 'library' }).previewToken,
  ).not.toBe(before.previewToken);
});
it('confirms one captured snapshot, omits token from persisted jobs, and exports its exact membership', async () => {
  const f = await fixture();
  const preview = f.service.preview(f.library.id, f.request);
  const job = ExportJobSchema.parse(
    f.service.start(f.library.id, {
      ...f.request,
      expectedPreviewToken: preview.previewToken,
    }),
  );
  f.boardPin(f.assets[2]!);
  f.catalog.updateAsset(f.assets[0]!.id, { note: 'Changed after start' });
  await expect.poll(() => f.service.get(job.id).status).toBe('completed');
  const zip = unzipSync(await readFile(f.service.archive(job.id).path));
  const entry = Object.keys(zip).find((name) =>
    name.endsWith('/manifest.json'),
  )!;
  const manifest = ExportManifestSchema.parse(
    JSON.parse(strFromU8(zip[entry]!)),
  );
  expect(manifest.assets.map((asset) => asset.id).sort()).toEqual(
    [
      ...preview.requestedAssetIds,
      ...preview.includedDependencyAssetIds,
    ].sort(),
  );
  expect(
    manifest.assets.find((asset) => asset.id === f.assets[0]!.id)?.note,
  ).toBe('');
  expect(f.service.get(job.id).request).toEqual(f.request);
  expect(
    f.database.sqlite
      .prepare('SELECT payload FROM export_jobs WHERE id=?')
      .get(job.id),
  ).not.toEqual(
    expect.objectContaining({
      payload: expect.stringContaining('expectedPreviewToken'),
    }),
  );
});
it('previews whole libraries including Trash and removed roots without treating them as dependencies', async () => {
  const f = await fixture();
  f.catalog.batchAssets(f.library.id, {
    assetIds: [f.assets[2]!.id],
    action: 'trash',
  });
  f.catalog.deleteRoot(f.root.id, 'offline');
  const preview = f.service.preview(f.library.id, { scope: 'library' });
  expect(preview.requestedAssetIds).toEqual(
    f.assets.map((asset) => asset.id).sort(),
  );
  expect(preview).toMatchObject({
    requestedAssetCount: 4,
    dependencyAssetCount: 0,
    totalAssetCount: 4,
    includedDependencyAssetIds: [],
    reasons: [],
  });
});
it('serves validated preview and dedicated stale errors through the real HTTP API', async () => {
  const f = await fixture();
  const app = await createApp({
    database: f.database,
    paths: f.paths,
    staticRoot: false,
  });
  cleanup.push(() => app.close());
  const previewResponse = await app.inject({
    method: 'POST',
    url: `/api/libraries/${f.library.id}/exports/preview`,
    payload: f.request,
  });
  expect(previewResponse.statusCode).toBe(200);
  const preview = ExportPreviewSchema.parse(previewResponse.json());
  f.boardPin(f.assets[2]!);
  const stale = await app.inject({
    method: 'POST',
    url: `/api/libraries/${f.library.id}/exports`,
    payload: { ...f.request, expectedPreviewToken: preview.previewToken },
  });
  expect(stale.statusCode).toBe(409);
  expect(stale.json()).toMatchObject({ code: 'EXPORT_PREVIEW_STALE' });
  expect(f.jobs()).toEqual({ count: 0 });
  const otherLibrary = f.catalog.createLibrary({ name: 'Other library' });
  const otherRoot = f.catalog.addRoot(
    otherLibrary.id,
    join(f.directory, 'other-root'),
  );
  const foreign = f.catalog.ingest({
    libraryId: otherLibrary.id,
    rootId: otherRoot.id,
    relativePath: 'foreign.bin',
    actualRelativePath: 'foreign.bin',
    processed: await f.processed('foreign'),
  }).asset;
  for (const url of [
    `/api/libraries/${f.library.id}/exports/preview`,
    `/api/libraries/${f.library.id}/exports`,
  ]) {
    const invalid = await app.inject({
      method: 'POST',
      url,
      payload: { scope: 'selection', assetIds: [randomUUID()] },
    });
    expect(invalid.statusCode).toBe(400);
    const foreignSelection = await app.inject({
      method: 'POST',
      url,
      payload: { scope: 'selection', assetIds: [foreign.id] },
    });
    expect(foreignSelection.statusCode).toBe(400);
    expect(foreignSelection.json().code).toBe('INVALID_RELATION');
  }
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/libraries/${randomUUID()}/exports/preview`,
        payload: { scope: 'library' },
      })
    ).statusCode,
  ).toBe(404);
});
