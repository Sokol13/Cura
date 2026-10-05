import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, expect, it } from 'vitest';
import { openDatabase } from '../src/database.js';
import { CatalogStore } from '../src/catalog-store.js';
import { MediaService } from '../src/media/service.js';
import { registerCatalogRoutes } from '../src/catalog-routes.js';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'cura-root-policy-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const paths = {
    data: join(directory, 'data'),
    cache: join(directory, 'cache'),
    log: join(directory, 'log'),
  };
  const database = openDatabase(paths);
  cleanup.push(async () => database.close());
  const store = new CatalogStore(database),
    media = new MediaService(store, paths),
    app = Fastify();
  await registerCatalogRoutes(app, store, media, paths);
  app.addHook('onClose', () => media.close());
  cleanup.push(() => app.close());
  const folder = join(directory, 'source');
  await mkdir(folder);
  const file = join(folder, '原始设计.svg');
  const bytes = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="8"><rect width="10" height="8" fill="red"/></svg>',
  );
  await writeFile(file, bytes);
  const library = store.createLibrary({ name: 'Root policy' });
  const root = await media.registerRoot(library.id, folder);
  await expect.poll(() => store.listAssets(library.id).total).toBe(1);
  return {
    app,
    store,
    media,
    file,
    bytes,
    library,
    root,
    asset: store.listAssets(library.id).items[0]!,
  };
}
it.each(['trash', 'offline'] as const)(
  'exposes the %s removal policy and preserves originals/history over HTTP',
  async (mode) => {
    const { app, store, file, bytes, library, root, asset } = await setup();
    const url = `/api/roots/${root.id}${mode === 'offline' ? '?mode=offline' : ''}`;
    const response = await app.inject({ method: 'DELETE', url });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      rootId: root.id,
      libraryId: library.id,
      affected: 1,
      trashed: mode === 'trash' ? 1 : 0,
      offline: mode === 'offline' ? 1 : 0,
      keptAvailable: 0,
    });
    expect(await readFile(file)).toEqual(bytes);
    expect(
      await readFile(store.getVersionFile(asset.currentVersionId).snapshotPath),
    ).toEqual(bytes);
    expect(store.listVersions(asset.id)).toHaveLength(1);
    const result = await app.inject(
      `/api/libraries/${library.id}/assets?missing=true&trash=${mode === 'trash'}`,
    );
    expect(result.statusCode).toBe(200);
    expect(result.json().items).toMatchObject([
      { id: asset.id, missing: true },
    ]);
    if (mode === 'trash') {
      expect(store.listAssets(library.id).total).toBe(0);
      const restored = await app.inject({
        method: 'POST',
        url: `/api/libraries/${library.id}/assets/batch`,
        payload: { assetIds: [asset.id], action: 'restore' },
      });
      expect(restored.statusCode).toBe(200);
      expect(store.getAsset(asset.id)).toMatchObject({
        missing: true,
        deletedAt: null,
        hash: asset.hash,
      });
    }
  },
);
it('rejects an unknown removal policy without stopping the registered directory', async () => {
  const { app, store, library, root } = await setup();
  const response = await app.inject({
    method: 'DELETE',
    url: `/api/roots/${root.id}?mode=destroy`,
  });
  expect(response.statusCode).toBe(400);
  expect(store.listRoots(library.id)).toHaveLength(1);
  expect(store.listAssets(library.id).total).toBe(1);
});
