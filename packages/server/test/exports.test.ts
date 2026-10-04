import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import sharp from 'sharp';
import { ExportManifestSchema } from '@cura/shared';
import { openDatabase } from '../src/database.js';
import { resolveUserPaths } from '../src/paths.js';
import { CatalogStore } from '../src/catalog-store.js';
import { MediaService } from '../src/media/service.js';
import { BoardStore } from '../src/boards/store.js';
import { BrandStore } from '../src/brands/store.js';
import { writeArchive, ArchiveLimitError } from '../src/exports/archive.js';
import { ExportService } from '../src/exports/service.js';
import { readExportSnapshot } from '../src/exports/snapshot.js';
import { csvCell, portableName } from '../src/exports/portable.js';
const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup.length = 0;
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'cura-export-'));
  const paths = resolveUserPaths({
    CURA_DATA_DIR: join(directory, 'data'),
    CURA_CACHE_DIR: join(directory, 'cache'),
    CURA_LOG_DIR: join(directory, 'logs'),
  });
  const database = openDatabase(paths),
    catalog = new CatalogStore(database),
    media = new MediaService(catalog, paths),
    service = new ExportService(database, paths);
  cleanup.push(
    () => rm(directory, { recursive: true, force: true }),
    () => database.close(),
    () => media.close(),
    () => service.close(),
  );
  const library = catalog.createLibrary({ name: '设计 / portable' });
  const image = async (color: string) =>
    sharp({ create: { width: 16, height: 12, channels: 3, background: color } })
      .png()
      .toBuffer();
  const original = await media.upload(
    library.id,
    '=SUM(1,2).png',
    await image('#ff0000'),
  );
  const other = await media.upload(
    library.id,
    'dependency.png',
    await image('#0000ff'),
  );
  const parent = catalog.createFolder(library.id, { name: '项目' });
  const folder = catalog.createFolder(library.id, {
    name: '发布',
    parentId: parent.id,
  });
  const group = catalog.createTagGroup(library.id, { name: '材质' });
  const tag = catalog.createTag(library.id, { name: '铜', groupId: group.id });
  catalog.createCollection(library.id, {
    name: '铜参考',
    rules: { tagId: tag.id, similarTo: other.id },
  });
  catalog.updateAsset(original.id, {
    folderId: folder.id,
    tagIds: [tag.id],
    prompt: 'line one, "quoted"\n第二行',
    seed: '18446744073709551615',
    params: {
      raw: { seed: '18446744073709551615', workflow: { nodes: [1, 2] } },
    },
    note: '=HYPERLINK("remote")',
    finalized: true,
  });
  catalog.createAnnotation(original.id, {
    versionId: original.currentVersionId,
    x: 0.2,
    y: 0.3,
    text: '版本注释',
  });
  const boards = new BoardStore(database),
    board = boards.createBoard(library.id, { name: 'Pinned board' });
  const slot = boards.createSlot(board.board.id, {
    label: 'Reference',
    expectedRevision: 0,
  });
  boards.assignSlot(slot.slots[0]!.id, {
    expectedRevision: 0,
    pin: { assetId: other.id, versionId: other.currentVersionId },
  });
  const template = boards.createTemplate(library.id, {
    name: 'Archived template',
    slots: [
      { key: 'hero', label: 'Hero', x: 0, y: 0, width: 300, height: 200 },
    ],
  });
  boards.deleteTemplate(template.id);
  const brands = new BrandStore(database),
    brand = brands.createBrand(library.id, { name: '品牌' });
  brands.saveBrand(brand.id, {
    expectedRevision: 0,
    name: brand.name,
    guidelines: 'Exact old logo',
    colors: [],
    fonts: [],
    logos: [
      {
        name: '标志',
        pin: { assetId: other.id, versionId: other.currentVersionId },
      },
    ],
  });
  await media.replace(original.id, '=SUM(1,2).png', await image('#ffff00'));
  await media.replace(other.id, 'dependency.png', await image('#1111ee'));
  return {
    directory,
    paths,
    database,
    catalog,
    media,
    service,
    library,
    original,
    other,
    boards,
    board,
    slot,
    image,
  };
}
test('portable names preserve Unicode and reject reserved names, separators and malformed surrogate endings', () => {
  expect(portableName('../CON?.png')).not.toMatch(/[\\/<>:?*]/);
  expect(portableName('CON')).toBe('_CON');
  expect(portableName('画'.repeat(100))).toMatch(/^画+$/);
  expect(
    Buffer.byteLength(portableName('画'.repeat(100)), 'utf8'),
  ).toBeLessThanOrEqual(100);
  expect(() =>
    encodeURIComponent(portableName('x'.repeat(99) + '😀')),
  ).not.toThrow();
});

test('portable CSV cells neutralize formulas without losing quoting, Unicode or newlines', () => {
  expect(csvCell('=SUM(1,2)')).toBe('"\'=SUM(1,2)"');
  expect(csvCell(' \t+cmd')).toBe('"\' \t+cmd"');
  expect(csvCell('汉字,"one"\ntwo')).toBe('"汉字,""one""\ntwo"');
});
test('selection snapshot closes historical board/brand pins and retains complete version provenance', async () => {
  const f = await fixture();
  const snapshot = readExportSnapshot(f.database, f.library.id, {
    scope: 'selection',
    assetIds: [f.original.id],
  });
  expect(snapshot.manifest.includedDependencyAssetIds).toEqual([f.other.id]);
  expect(snapshot.manifest.assets).toHaveLength(2);
  expect(
    snapshot.manifest.versions.find(
      (version) => version.id === f.original.currentVersionId,
    ),
  ).toMatchObject({
    seed: '18446744073709551615',
    params: { raw: { seed: '18446744073709551615' } },
  });
  expect(snapshot.manifest.boards.slots).toHaveLength(1);
  expect(snapshot.manifest.brands.brands).toHaveLength(1);
  expect(snapshot.manifest.annotations).toHaveLength(1);
  expect(snapshot.manifest.folders).toHaveLength(2);
  expect(snapshot.manifest.tags[0]?.groupId).toBe(
    snapshot.manifest.tagGroups[0]?.id,
  );
  expect(snapshot.manifest.assetTags).toEqual([
    expect.objectContaining({
      assetId: f.original.id,
      tagId: snapshot.manifest.tags[0]?.id,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    }),
  ]);
  expect(snapshot.manifest.collections[0]?.rules.similarTo).toBe(f.other.id);
  expect(snapshot.manifest.boards.templates).toEqual([
    expect.objectContaining({
      name: 'Archived template',
      deletedAt: expect.any(String),
    }),
  ]);
  expect(JSON.stringify(snapshot.manifest)).not.toContain('snapshotPath');
  expect(() =>
    readExportSnapshot(f.database, f.library.id, {
      scope: 'selection',
      assetIds: [randomUUID()],
    }),
  ).toThrow();
});
test('whole export verifies every retained version including trash and removed roots, and fails visibly for corruption', async () => {
  const f = await fixture();
  const sourceDirectory = join(f.directory, 'sources');
  await mkdir(sourceDirectory);
  const originalFile = join(sourceDirectory, 'retained.png');
  await writeFile(originalFile, await f.image('#00ff00'));
  const root = await f.media.registerRoot(f.library.id, sourceDirectory);
  await vi.waitFor(
    () =>
      expect(f.catalog.listAssets(f.library.id, { q: 'retained' }).total).toBe(
        1,
      ),
    { timeout: 10000 },
  );
  const retained = f.catalog.listAssets(f.library.id, { q: 'retained' })
    .items[0]!;
  await f.media.unregisterRoot(root.id);
  f.catalog.batchAssets(f.library.id, {
    assetIds: [retained.id],
    action: 'trash',
  });
  const job = f.service.start(f.library.id, { scope: 'library' });
  f.catalog.updateAsset(f.original.id, { note: 'Changed after snapshot' });
  await vi.waitFor(
    () => expect(f.service.get(job.id).status).toBe('completed'),
    { timeout: 10000 },
  );
  const files = unzipSync(await readFile(f.service.archive(job.id).path));
  const manifestEntry = Object.keys(files).find((path) =>
    path.endsWith('/manifest.json'),
  )!;
  const prefix = manifestEntry.slice(0, -'manifest.json'.length);
  const manifest = ExportManifestSchema.parse(
    JSON.parse(strFromU8(files[manifestEntry]!)),
  );
  expect(
    manifest.assets.find((asset) => asset.id === retained.id)?.deletedAt,
  ).toBeTruthy();
  expect(
    manifest.roots.find((item) => item.id === root.id)?.removedAt,
  ).toBeTruthy();
  expect(
    manifest.sources.find((item) => item.assetId === retained.id)?.available,
  ).toBe(false);
  for (const file of manifest.files) {
    expect(
      createHash('sha256')
        .update(files[prefix + file.path]!)
        .digest('hex'),
    ).toBe(file.sha256);
    expect(files[prefix + file.path]).toHaveLength(file.size);
  }
  expect(strFromU8(files[prefix + 'assets.csv']!)).toContain(
    '"\'=SUM(1,2).png"',
  );
  expect(JSON.stringify(manifest)).not.toContain(f.paths.cache);
  expect(JSON.stringify(manifest)).not.toContain(join(f.paths.data, 'objects'));
  await chmod(
    f.catalog.getVersionFile(retained.currentVersionId).snapshotPath,
    0o600,
  );
  await writeFile(
    f.catalog.getVersionFile(retained.currentVersionId).snapshotPath,
    Buffer.alloc(retained.size, 0),
  );
  const broken = f.service.start(f.library.id, { scope: 'library' });
  await vi.waitFor(
    () => expect(f.service.get(broken.id).status).toBe('failed'),
    { timeout: 10000 },
  );
  expect(f.service.get(broken.id).exceptions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'SNAPSHOT_INVALID',
        versionId: retained.currentVersionId,
      }),
    ]),
  );
  expect(() => f.service.archive(broken.id)).toThrow();
  await rm(f.catalog.getVersionFile(retained.currentVersionId).snapshotPath);
  const missing = f.service.start(f.library.id, { scope: 'library' });
  await vi.waitFor(
    () => expect(f.service.get(missing.id).status).toBe('failed'),
    { timeout: 10000 },
  );
  expect(f.service.get(missing.id).exceptions[0]?.versionId).toBe(
    retained.currentVersionId,
  );
});

test('archives exceeding classic ZIP entry or size bounds fail explicitly before writing files', async () => {
  const f = await fixture();
  const snapshot = readExportSnapshot(f.database, f.library.id, {
    scope: 'library',
  });
  const oversized = {
    ...snapshot,
    files: Array.from({ length: 65533 }, () => snapshot.files[0]!),
  };
  await expect(
    writeArchive(
      oversized,
      join(f.directory, 'too-many.zip'),
      f.paths.data,
      () => undefined,
    ),
  ).rejects.toBeInstanceOf(ArchiveLimitError);
  const tooLarge = {
    ...snapshot,
    files: [{ ...snapshot.files[0]!, size: 3_500_000_001 }],
  };
  await expect(
    writeArchive(
      tooLarge,
      join(f.directory, 'too-large.zip'),
      f.paths.data,
      () => undefined,
    ),
  ).rejects.toBeInstanceOf(ArchiveLimitError);
});
