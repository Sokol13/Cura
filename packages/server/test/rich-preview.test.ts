import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
  await registerPreviewRoutes(app, store, media);
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
