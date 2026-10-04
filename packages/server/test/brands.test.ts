import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { registerBrandRoutes } from '../src/brands/routes.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { colorValues, rgbToHex, cmykToHex } from '@cura/shared';
import { openDatabase } from '../src/database.js';
import { resolveUserPaths } from '../src/paths.js';
import { CatalogStore, type IngestedFile } from '../src/catalog-store.js';
import { BrandStore, readBrandExport } from '../src/brands/store.js';
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});
const file = (hash: string): IngestedFile => ({
  hash,
  size: 10,
  type: 'image/png',
  width: 10,
  height: 10,
  colors: ['#ff0000'],
  phash: '0000000000000000',
  exif: {},
  generation: {
    prompt: '',
    negativePrompt: '',
    model: '',
    source: '',
    seed: '',
    params: {},
  },
  snapshotPath: `/snapshots/${hash}`,
  thumbnailPath: null,
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'cura-brands-'));
  const db = openDatabase(
    resolveUserPaths({
      CURA_DATA_DIR: join(dir, 'data'),
      CURA_CACHE_DIR: join(dir, 'cache'),
      CURA_LOG_DIR: join(dir, 'log'),
    }),
  );
  if (
    !db.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE name='brands'")
      .get()
  )
    db.sqlite.exec(
      readFileSync(
        new URL('../drizzle/0005_brands.sql', import.meta.url),
        'utf8',
      ),
    );
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  cleanups.push(() => db.close());
  const catalog = new CatalogStore(db),
    store = new BrandStore(db);
  const library = catalog.createLibrary({ name: '品牌库' }),
    root = catalog.addRoot(library.id, '/source');
  const asset = catalog.ingest({
    libraryId: library.id,
    rootId: root.id,
    relativePath: 'logo.png',
    actualRelativePath: 'logo.png',
    processed: file('first'),
  }).asset;
  return {
    dir,
    db,
    catalog,
    store,
    library,
    asset,
    pin: { assetId: asset.id, versionId: asset.currentVersionId },
  };
}
it('converts canonical RGB/HEX and unprofiled CMYK including black', () => {
  expect(colorValues('#FF0000')).toEqual({
    hex: '#ff0000',
    rgb: [255, 0, 0],
    cmyk: [0, 100, 100, 0],
  });
  expect(colorValues('#000000').cmyk).toEqual([0, 0, 0, 100]);
  expect(rgbToHex([12, 34, 56])).toBe('#0c2238');
  expect(cmykToHex([0, 100, 100, 0])).toBe('#ff0000');
  expect(() => rgbToHex([256, 0, 0])).toThrow();
});
it('persists ordered kits and CMF, pins versions and exports complete records', async () => {
  const f = await fixture(),
    brand = f.store.createBrand(f.library.id, { name: '中文品牌' });
  const saved = f.store.saveBrand(brand.id, {
    name: brand.name,
    expectedRevision: 0,
    guidelines: '# 使用规范\n保留中文',
    colors: [
      { name: '红', hex: '#FF0000' },
      { name: '黑', hex: '#000000' },
    ],
    fonts: [{ name: '正文字体', role: 'body', pin: f.pin }],
    logos: [{ name: '横版', pin: f.pin }],
  });
  f.catalog.replaceAsset(f.asset.id, file('second'), 'new.png');
  expect(f.store.getBrand(brand.id).logos[0]?.pin).toEqual(f.pin);
  const next = f.store.saveBrand(brand.id, {
    name: saved.name,
    guidelines: saved.guidelines,
    expectedRevision: saved.revision,
    colors: [...saved.colors]
      .reverse()
      .map(({ id, name, hex }) => ({ id, name, hex })),
    fonts: saved.fonts.map(({ id, name, role, pin }) => ({
      id,
      name,
      role,
      pin,
    })),
    logos: saved.logos.map(({ id, name, pin }) => ({ id, name, pin })),
  });
  expect(next.colors.map((c) => c.name)).toEqual(['黑', '红']);
  expect(next.colors[1]?.createdAt).toBe(saved.colors[0]?.createdAt);
  const cmf = f.store.createCmfBoard(f.library.id, { name: '材质板' });
  f.store.saveCmfBoard(cmf.id, {
    name: cmf.name,
    expectedRevision: 0,
    entries: [
      {
        name: '铝材',
        colorName: '红',
        hex: '#ff0000',
        process: '阳极氧化',
        pin: f.pin,
      },
    ],
  });
  const exported = readBrandExport(f.db, f.library.id);
  expect(exported.pins).toEqual([f.pin]);
  expect(exported.cmfBoards[0]?.entries[0]?.process).toBe('阳极氧化');
  expect(exported.brands[0]?.guidelines).toContain('保留中文');
  expect(new BrandStore(f.db).getBrand(brand.id)).toEqual(next);
});
it('rejects stale edits and cross-parent IDs/pins without partial writes', async () => {
  const f = await fixture(),
    brand = f.store.createBrand(f.library.id, { name: 'First' }),
    other = f.store.createBrand(f.library.id, { name: 'Other' });
  const empty = {
    name: 'Changed',
    expectedRevision: 0,
    guidelines: '',
    colors: [],
    fonts: [],
    logos: [],
  };
  const saved = f.store.saveBrand(other.id, {
    ...empty,
    colors: [{ name: 'red', hex: '#ff0000' }],
  });
  expect(() =>
    f.store.saveBrand(brand.id, {
      ...empty,
      colors: saved.colors.map(({ id, name, hex }) => ({ id, name, hex })),
    }),
  ).toThrow();
  const otherLib = f.catalog.createLibrary({ name: 'Other library' }),
    root = f.catalog.addRoot(otherLib.id, '/other');
  const asset = f.catalog.ingest({
    libraryId: otherLib.id,
    rootId: root.id,
    relativePath: 'a.png',
    actualRelativePath: 'a.png',
    processed: file('third'),
  }).asset;
  expect(() =>
    f.store.saveBrand(brand.id, {
      ...empty,
      logos: [
        {
          name: 'Foreign',
          pin: { assetId: asset.id, versionId: asset.currentVersionId },
        },
      ],
    }),
  ).toThrow();
  expect(f.store.getBrand(brand.id).name).toBe('First');
  f.store.saveBrand(brand.id, empty);
  expect(() => f.store.saveBrand(brand.id, empty)).toThrowError(
    expect.objectContaining({ statusCode: 409 }),
  );
  f.store.deleteBrand(brand.id);
  expect(() => f.store.getBrand(brand.id)).toThrow();
  expect(f.catalog.getAsset(f.asset.id).id).toBe(f.asset.id);
});

it('exports exact pinned bytes and rejects altered retained data', async () => {
  const f = await fixture();
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) =>
    reply
      .code((error as { statusCode?: number }).statusCode ?? 500)
      .send({ error: String(error) }),
  );
  const paths = resolveUserPaths({
    CURA_DATA_DIR: join(f.dir, 'data'),
    CURA_CACHE_DIR: join(f.dir, 'cache'),
    CURA_LOG_DIR: join(f.dir, 'log'),
  });
  registerBrandRoutes(app, f.db, f.catalog, paths);
  cleanups.push(() => app.close());
  const bytes = Buffer.from('pinned original font bytes');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const snapshotPath = join(paths.data, 'retained-font');
  await writeFile(snapshotPath, bytes);
  const original = f.catalog.getAsset(f.asset.id);
  const asset = f.catalog.ingest({
    libraryId: f.library.id,
    rootId: original.rootId,
    relativePath: 'font.ttf',
    actualRelativePath: 'font.ttf',
    processed: { ...file(hash), snapshotPath },
  }).asset;
  const brand = f.store.createBrand(f.library.id, { name: 'Portable' });
  f.store.saveBrand(brand.id, {
    name: brand.name,
    guidelines: '',
    expectedRevision: 0,
    colors: [],
    logos: [],
    fonts: [
      {
        name: 'Font',
        role: 'Body',
        pin: { assetId: asset.id, versionId: asset.currentVersionId },
      },
    ],
  });
  const response = await app.inject({ url: `/api/brands/${brand.id}/package` });
  expect(response.statusCode).toBe(200);
  const data = response.json() as { files: { base64: string; hash: string }[] };
  expect(Buffer.from(data.files[0]!.base64, 'base64')).toEqual(bytes);
  expect(data.files[0]!.hash).toBe(hash);
  expect(response.body).not.toContain(snapshotPath);
  await writeFile(snapshotPath, 'corrupted');
  expect(
    (await app.inject({ url: `/api/brands/${brand.id}/package` })).statusCode,
  ).toBe(409);
});
