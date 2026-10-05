import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, expect, it } from 'vitest';
import { CatalogStore } from '../src/catalog-store.js';
import { openDatabase } from '../src/database.js';
import { MediaService } from '../src/media/service.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'cura-native-psd-'));
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
  cleanup.push(() => media.close());
  const library = store.createLibrary({ name: 'Native PSD previews' });
  const bytes = await readFile(
    fileURLToPath(
      new URL('../../../e2e/fixtures/rich/quadrants-raw.psd', import.meta.url),
    ),
  );
  return { directory, paths, store, media, library, bytes };
}
it('generates PSD thumbnails in the worker before browser rendering, preserving dimensions and immutable bytes', async () => {
  const { store, media, library, bytes } = await setup();
  const asset = await media.upload(library.id, 'design.psd', bytes);
  expect(asset.previewState).toBe('ready');
  expect(asset.type).toBe('image/vnd.adobe.photoshop');
  expect([asset.width, asset.height]).toEqual([
    bytes.readUInt32BE(18),
    bytes.readUInt32BE(14),
  ]);
  expect(asset.hash).toBe(createHash('sha256').update(bytes).digest('hex'));
  expect(store.listPendingPreviews(library.id)).toEqual([]);
  const file = store.getVersionFile(asset.currentVersionId);
  expect(await readFile(file.snapshotPath)).toEqual(bytes);
  const { data, info } = await sharp(file.thumbnailPath!)
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(info.width).toBeLessThanOrEqual(512);
  const point =
    (Math.floor(info.height / 4) * info.width + Math.floor(info.width / 4)) *
    info.channels;
  expect(data[point]).toBeGreaterThan(200);
  expect(data[point + 2]).toBeLessThan(30);
});
it('rebuilds current and historical PSD thumbnails entirely from retained snapshots', async () => {
  const { store, media, library, bytes } = await setup();
  const asset = await media.upload(library.id, 'first.psd', bytes);
  const next = await readFile(
    fileURLToPath(
      new URL('../../../e2e/fixtures/rich/quadrants-rle.psd', import.meta.url),
    ),
  );
  const replaced = await media.replace(asset.id, 'second.psd', next);
  const hashes = store.listVersions(asset.id).map((v) => v.hash);
  await media.clearCache();
  await media.rebuildCache();
  expect(store.listVersions(asset.id).map((v) => v.hash)).toEqual(hashes);
  for (const id of [asset.currentVersionId, replaced.currentVersionId]) {
    expect(store.getVersionPreview(id).previewState).toBe('ready');
    expect(
      (await sharp(store.getVersionFile(id).thumbnailPath!).metadata()).format,
    ).toBe('webp');
  }
});
it('recovers pre-upgrade size-limit failures on resume even with an offline source, without creating versions', async () => {
  const { store, media, library, bytes, directory } = await setup();
  const folder = join(directory, 'sources');
  await mkdir(folder);
  const source = join(folder, 'offline.psd');
  await writeFile(source, bytes);
  const root = await media.registerRoot(library.id, folder);
  await expect.poll(() => store.listAssets(library.id, {}).total).toBe(1);
  const asset = store.listAssets(library.id, {}).items[0]!;
  store.updateVersionPreview(asset!.currentVersionId, null, {
    state: 'unsupported',
    error: 'SIZE_LIMIT',
  });
  await media.unregisterRoot(root.id);
  await rm(source);
  await media.resume();
  await expect.poll(() => store.getAsset(asset!.id).previewState).toBe('ready');
  expect(store.getAsset(asset!.id).missing).toBe(true);
  expect(store.listVersions(asset!.id)).toHaveLength(1);
  expect(
    await readFile(store.getVersionFile(asset!.currentVersionId).snapshotPath),
  ).toEqual(bytes);
});
it('retains original dimensions and browser fallback for damaged PSD composites', async () => {
  const { store, media, library, bytes } = await setup();
  const asset = await media.upload(
    library.id,
    'damaged.psd',
    bytes.subarray(0, 26),
  );
  expect(asset.previewState).not.toBe('ready');
  expect([asset.width, asset.height]).toEqual([
    bytes.readUInt32BE(18),
    bytes.readUInt32BE(14),
  ]);
  expect(store.listPendingPreviews(library.id).map((v) => v.id)).toContain(
    asset.currentVersionId,
  );
});

it('reserves native rebuilds before browser polling and releases failed PSDs to fallback', async () => {
  const { store, media, library, bytes } = await setup();
  const asset = await media.upload(library.id, 'valid.psd', bytes);
  const damaged = await media.upload(
    library.id,
    'damaged.psd',
    bytes.subarray(0, 26),
  );
  store.updateVersionPreview(asset.currentVersionId, null);
  const pending = media.rebuildCache();
  expect(media.listPendingPreviews(library.id)).toEqual([]);
  await pending;
  expect(media.listPendingPreviews(library.id).map((v) => v.id)).toEqual([
    damaged.currentVersionId,
  ]);
  expect(store.getVersionPreview(asset.currentVersionId).previewState).toBe(
    'ready',
  );
});
