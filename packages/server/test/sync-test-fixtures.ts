import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { openDatabase } from '../src/database.js';
import { CatalogStore, type IngestedFile } from '../src/catalog-store.js';
import { BoardStore } from '../src/boards/store.js';
import { BrandStore } from '../src/brands/store.js';

const cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});
export async function fixture(seed = true) {
  const dir = await mkdtemp(join(tmpdir(), 'cura-sync-')),
    paths = {
      data: join(dir, 'data'),
      cache: join(dir, 'cache'),
      log: join(dir, 'log'),
    };
  const db = openDatabase(paths),
    catalog = new CatalogStore(db),
    boards = new BoardStore(db),
    brands = new BrandStore(db);
  cleanup.push(
    () => rm(dir, { recursive: true, force: true }),
    () => db.close(),
  );
  const library = seed ? catalog.createLibrary({ name: '共享创作' }) : null;
  const root = library
    ? catalog.addRoot(library.id, join(dir, 'originals'))
    : null;
  for (const migration of ['0006_automation', '0007_sync']) {
    const table = migration.startsWith('0006')
      ? 'automation_jobs'
      : 'sync_links';
    if (
      !db.sqlite
        .prepare('SELECT name FROM sqlite_master WHERE name=?')
        .get(table)
    )
      db.sqlite.exec(
        readFileSync(
          new URL(`../drizzle/${migration}.sql`, import.meta.url),
          'utf8',
        ),
      );
  }
  const file = async (text: string): Promise<IngestedFile> => {
    const bytes = Buffer.from(text),
      hash = createHash('sha256').update(bytes).digest('hex');
    const snapshotPath = join(paths.data, 'objects', hash);
    await mkdir(join(paths.data, 'objects'), { recursive: true });
    await writeFile(snapshotPath, bytes);
    return {
      hash,
      size: bytes.length,
      type: 'image/png',
      width: 300,
      height: 200,
      colors: ['#ff0000'],
      phash: '0000000000000000',
      exif: { description: '原始' },
      generation: {
        prompt: 'forest',
        negativePrompt: 'noise',
        model: '模型',
        seed: '18446744073709551615',
        source: 'ComfyUI',
        params: { libraryId: 'authored-json-is-not-a-relation' },
      },
      snapshotPath,
      thumbnailPath: null,
    };
  };
  return { dir, paths, db, catalog, boards, brands, library, root, file };
}
export async function graphFixture() {
  const f = await fixture(),
    library = f.library!,
    root = f.root!;
  const processed = await f.file('v1'),
    asset = f.catalog.ingest({
      libraryId: library.id,
      rootId: root.id,
      relativePath: '中文-é.png',
      actualRelativePath: '中文-é.png',
      processed,
    }).asset;
  const pin = { assetId: asset.id, versionId: asset.currentVersionId };
  const tag = f.catalog.createTag(library.id, { name: '主角' });
  f.catalog.updateAsset(asset.id, { tagIds: [tag.id], note: '笔记' });
  f.catalog.createAnnotation(asset.id, {
    versionId: pin.versionId,
    x: 0.2,
    y: 0.3,
    text: '旧版',
  });
  f.catalog.replaceAsset(asset.id, await f.file('v2'), 'new.png');
  const template = f.boards.listTemplates(library.id)[0]!;
  const board = f.boards.createBoard(library.id, {
    name: '角色',
    templateId: template.id,
  });
  f.boards.assignSlot(board.slots[0]!.id, { expectedRevision: 0, pin });
  const brand = f.brands.createBrand(library.id, { name: '品牌' });
  f.brands.saveBrand(brand.id, {
    expectedRevision: 0,
    name: brand.name,
    guidelines: '# 品牌',
    colors: [{ name: 'red', hex: '#ff0000' }],
    fonts: [],
    logos: [{ name: '历史', pin }],
  });
  return { ...f, library, root, asset, pin };
}
