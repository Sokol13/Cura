import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import sharp from 'sharp';
import { afterEach, expect, it } from 'vitest';
import { CatalogStore } from '../src/catalog-store.js';
import { openDatabase } from '../src/database.js';
import { MediaService } from '../src/media/service.js';
import { registerCatalogRoutes } from '../src/catalog-routes.js';
import { registerPreviewRoutes } from '../src/media/preview-routes.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'cura-rich-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const paths = {
    data: join(directory, 'data'),
    cache: join(directory, 'cache'),
    log: join(directory, 'log'),
  };
  const db = openDatabase(paths);
  cleanup.push(async () => db.close());
  const store = new CatalogStore(db);
  const media = new MediaService(store, paths);
  const app = Fastify();
  await registerCatalogRoutes(app, store, media, paths);
  await registerPreviewRoutes(app, media);
  app.addHook('onClose', () => media.close());
  cleanup.push(() => app.close());
  const library = store.createLibrary({ name: 'Rich previews' });
  const original = Buffer.from('%PDF-1.4\nfixture bytes retained');
  const asset = await media.upload(library.id, 'draft.pdf', original);
  const png = await sharp({
    create: { width: 64, height: 48, channels: 3, background: '#ee3300' },
  })
    .png()
    .toBuffer();
  const candidates = async () =>
    (await app.inject({ url: `/api/libraries/${library.id}/previews` })).json<{
      items: { id: string; sourceHash: string; revision: number }[];
    }>().items;
  const submit = (
    id: string,
    hash: string,
    revision: number,
    bytes: Buffer = png,
  ) =>
    app.inject({
      method: 'POST',
      url: `/api/versions/${id}/preview?sourceHash=${hash}&revision=${revision}&renderer=cura-rich-v1`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: bytes,
    });
  return {
    app,
    store,
    media,
    asset,
    original,
    png,
    library,
    candidates,
    submit,
  };
}
it('accepts a version-scoped raster, changes preview revision and preserves source bytes', async () => {
  const { app, store, asset, original, candidates, submit } = await setup();
  const candidate = (await candidates())[0]!;
  expect(candidate.id).toBe(asset.currentVersionId);
  const fallback = await app.inject({
    url: `/api/versions/${candidate.id}/thumbnail`,
  });
  expect(fallback.headers['cache-control']).toBe('no-store');
  expect(
    (await submit(candidate.id, candidate.sourceHash, candidate.revision))
      .statusCode,
  ).toBe(200);
  const updated = store.getAsset(asset.id);
  expect(updated.previewState).toBe('ready');
  expect(updated.previewRevision).toBeGreaterThan(candidate.revision);
  expect(updated.hash).toBe(asset.hash);
  expect(store.listVersions(asset.id)).toHaveLength(1);
  const file = store.getVersionFile(candidate.id);
  expect(await readFile(file.snapshotPath)).toEqual(original);
  const thumbnail = await app.inject({
    url: `/api/versions/${candidate.id}/thumbnail?revision=${updated.previewRevision}`,
  });
  expect(thumbnail.headers['content-type']).toContain('image/webp');
  const decoded = await sharp(thumbnail.rawPayload).raw().toBuffer();
  expect(decoded[0]).toBeGreaterThan(200);
  expect(decoded[2]).toBeLessThan(20);
  expect(await candidates()).toEqual([]);
});
it('rejects stale source hashes, stale cache revisions, active content and oversized raster dimensions', async () => {
  const { media, asset, png, candidates, submit } = await setup();
  const candidate = (await candidates())[0]!;
  expect(
    (await submit(candidate.id, '0'.repeat(64), candidate.revision)).statusCode,
  ).toBe(409);
  expect(
    (
      await submit(
        candidate.id,
        candidate.sourceHash,
        candidate.revision,
        Buffer.from('<svg/>'),
      )
    ).statusCode,
  ).toBe(400);
  const huge = await sharp({
    create: { width: 2049, height: 1, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  expect(
    (await submit(candidate.id, candidate.sourceHash, candidate.revision, huge))
      .statusCode,
  ).toBe(400);
  await media.clearCache();
  expect(
    (await submit(candidate.id, candidate.sourceHash, candidate.revision, png))
      .statusCode,
  ).toBe(409);
  expect(asset.hash).toBe(candidate.sourceHash);
});
it('clears and schedules every retained rich version while preserving archived snapshots', async () => {
  const { store, media, asset, original, library, candidates, submit } =
    await setup();
  const first = (await candidates())[0]!;
  await submit(first.id, first.sourceHash, first.revision);
  const newer = await media.replace(
    asset.id,
    'next.pdf',
    Buffer.from('%PDF-1.4\nnext version'),
  );
  const next = (await candidates())[0]!;
  await submit(next.id, next.sourceHash, next.revision);
  await media.clearCache();
  expect((await media.cacheInfo()).files).toBe(0);
  expect((await candidates()).map((v) => v.id).sort()).toEqual(
    [asset.currentVersionId, newer.currentVersionId].sort(),
  );
  expect(
    await readFile(store.getVersionFile(asset.currentVersionId).snapshotPath),
  ).toEqual(original);
  await media.rebuildCache();
  expect(store.listVersions(asset.id)).toHaveLength(2);
  expect(store.listAssets(library.id, {}).total).toBe(1);
});
it('persists an explicit unsupported state and retries only after cache rebuild', async () => {
  const { app, store, media, asset, candidates } = await setup();
  const first = (await candidates())[0]!;
  const response = await app.inject({
    method: 'PATCH',
    url: `/api/versions/${first.id}/preview`,
    payload: {
      sourceHash: first.sourceHash,
      revision: first.revision,
      state: 'unsupported',
      error: 'VIDEO_CODEC',
    },
  });
  expect(response.statusCode).toBe(200);
  expect(store.getAsset(asset.id).previewError).toBe('VIDEO_CODEC');
  expect(await candidates()).toEqual([]);
  await media.rebuildCache();
  expect((await candidates())[0]?.id).toBe(first.id);
});

it('classifies original rich formats without passing documents through the raster decoder', async () => {
  const { media, library } = await setup();
  for (const [name, type] of [
    ['orange-cube.glb', 'model/gltf-binary'],
    ['orange-cube.obj', 'model/obj'],
    ['quadrants-raw.psd', 'image/vnd.adobe.photoshop'],
    ['two-pages.pdf', 'application/pdf'],
    ['first-frame.mp4', 'video/mp4'],
    ['first-frame.mov', 'video/quicktime'],
  ]) {
    const bytes = await readFile(
      fileURLToPath(
        new URL(`../../../e2e/fixtures/rich/${name}`, import.meta.url),
      ),
    );
    expect((await media.upload(library.id, name!, bytes)).type, name).toBe(
      type,
    );
  }
});

it('keeps 1920×1080 source dimensions after receiving a 1024×576 preview and never invents model dimensions', async () => {
  const { media, library, store, candidates, submit } = await setup();
  const source = Buffer.alloc(40 + 1920 * 1080 * 3);
  source.write('8BPS');
  source.writeUInt16BE(1, 4);
  source.writeUInt16BE(3, 12);
  source.writeUInt32BE(1080, 14);
  source.writeUInt32BE(1920, 18);
  source.writeUInt16BE(8, 22);
  source.writeUInt16BE(3, 24);
  const asset = await media.upload(library.id, 'full-size.psd', source);
  expect([asset.width, asset.height]).toEqual([1920, 1080]);
  // Exercise a legacy browser submission even though native PSD rendering is now preferred.
  store.updateVersionPreview(asset.currentVersionId, null);
  const preview = await sharp({
    create: { width: 1024, height: 576, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  const candidate = (await candidates()).find(
    (item) => item.id === asset.currentVersionId,
  )!;
  expect(
    (
      await submit(
        candidate.id,
        candidate.sourceHash,
        candidate.revision,
        preview,
      )
    ).statusCode,
  ).toBe(200);
  const updated = store.getAsset(asset.id);
  expect([updated.width, updated.height]).toEqual([1920, 1080]);
  expect(store.listVersions(asset.id)[0]).toMatchObject({
    width: 1920,
    height: 1080,
  });
  const model = await media.upload(
    library.id,
    'cube.glb',
    await readFile(
      fileURLToPath(
        new URL('../../../e2e/fixtures/rich/orange-cube.glb', import.meta.url),
      ),
    ),
  );
  const modelJob = (await candidates()).find(
    (item) => item.id === model.currentVersionId,
  )!;
  await submit(modelJob.id, modelJob.sourceHash, modelJob.revision, preview);
  expect(store.getAsset(model.id)).toMatchObject({ width: null, height: null });
});
