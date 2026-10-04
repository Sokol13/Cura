// Run with Node 22 against two separately built Cura source directories.
// All mutable data is generated in a private temporary directory and removed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

const [oldArgument, nextArgument, outputArgument] = process.argv.slice(2);
assert(
  oldArgument && nextArgument && outputArgument,
  'Usage: node verify-upgrade.mjs OLD_BUILT_ROOT P1_BUILT_ROOT OUTPUT_JSON',
);
const oldRoot = resolve(oldArgument),
  nextRoot = resolve(nextArgument),
  output = resolve(outputArgument);
const load = (root, module) =>
  import(pathToFileURL(join(root, 'packages/server/dist', module)).href);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const seed = '18446744073709551615';
function chunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  const length = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, payload, checksum]);
}
function png(red, prompt) {
  const width = 24,
    height = 16,
    header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 3 + 1) + x * 3 + 1;
      pixels[offset] = red;
      pixels[offset + 1] = x * 9;
      pixels[offset + 2] = y * 13;
    }
  const parameters = `${prompt}\nNegative prompt: blur\nSteps: 28, Sampler: Euler, CFG scale: 7, Seed: ${seed}, Size: 24x16, Model: upgrade-fixture`;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk(
      'iTXt',
      Buffer.concat([
        Buffer.from('parameters\0\0\0\0\0'),
        Buffer.from(parameters),
      ]),
    ),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const fixture = await mkdtemp(join(tmpdir(), 'cura-upgrade-evidence-'));
const paths = {
  data: join(fixture, 'data'),
  cache: join(fixture, 'cache'),
  log: join(fixture, 'log'),
};
const originals = join(fixture, '原始参考'),
  original = join(originals, '方案 α', '角色 初稿.png');
const originalBytes = png(70, '中文初稿，柔和光线'),
  replacementBytes = png(210, '中文终稿，清晰轮廓');
const checks = {};
let database, media;
const migrationRows = (db) =>
  db.sqlite.prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all();
const oldFields = (value, baseline) =>
  Object.fromEntries(Object.keys(baseline).map((key) => [key, value[key]]));
function logicalDigest(db) {
  const names = db.sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  return sha256(
    JSON.stringify(
      names.map(({ name }) => [
        name,
        db.sqlite
          .prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`)
          .all()
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ]),
    ),
  );
}
async function migrations(root) {
  const journal = JSON.parse(
    await readFile(
      join(root, 'packages/server/drizzle/meta/_journal.json'),
      'utf8',
    ),
  );
  return Promise.all(
    journal.entries.map(async (entry) => ({
      tag: entry.tag,
      sha256: sha256(
        await readFile(
          join(root, 'packages/server/drizzle', `${entry.tag}.sql`),
        ),
      ),
    })),
  );
}
try {
  const [
    { openDatabase: openOld },
    { CatalogStore: OldCatalog },
    { MediaService: OldMedia },
  ] = await Promise.all([
    load(oldRoot, 'database.js'),
    load(oldRoot, 'catalog-store.js'),
    load(oldRoot, 'media/service.js'),
  ]);
  await mkdir(dirname(original), { recursive: true });
  await writeFile(original, originalBytes);
  database = openOld(paths);
  const oldStore = new OldCatalog(database);
  media = new OldMedia(oldStore, paths);
  assert.equal(migrationRows(database).length, 3);
  const library = oldStore.createLibrary({ name: '升级验证 · 设计资料' });
  const root = await media.registerRoot(library.id, originals);
  const deadline = Date.now() + 15000;
  let asset;
  while (Date.now() < deadline) {
    asset = oldStore.listAssets(library.id).items[0];
    if (asset) break;
    await new Promise((done) => setTimeout(done, 25));
  }
  assert(asset, 'Released MediaService must ingest the Unicode reference file');
  assert.equal(
    asset.seed,
    seed,
    'PNG extraction must preserve uint64 seed exactly as a string',
  );
  const firstVersion = asset.currentVersionId;
  const group = oldStore.createTagGroup(library.id, { name: '材质与情绪' });
  const tag = oldStore.createTag(library.id, {
    name: '暖色 ✓',
    color: '#f49245',
    groupId: group.id,
  });
  const parent = oldStore.createFolder(library.id, {
    name: '研发',
    parentId: null,
  });
  const folder = oldStore.createFolder(library.id, {
    name: '角色 / 方案',
    parentId: parent.id,
  });
  oldStore.updateAsset(asset.id, {
    folderId: folder.id,
    tagIds: [tag.id],
    rating: 5,
    note: '保留注释、层级与定稿状态。',
    prompt: '初版提示词 α',
    negativePrompt: '模糊',
    model: '模型 V1',
    source: '本地生成器',
    seed,
    params: { steps: 28, seed, details: { sampler: 'Euler', cfg: 7 } },
  });
  oldStore.createAnnotation(asset.id, {
    versionId: firstVersion,
    x: 0.25,
    y: 0.6,
    text: 'V1：保留阴影细节',
  });
  asset = await media.replace(asset.id, '角色 终稿 V2.png', replacementBytes);
  assert.notEqual(asset.currentVersionId, firstVersion);
  assert.equal(asset.seed, seed);
  oldStore.updateAsset(asset.id, {
    finalized: true,
    prompt: '终版提示词 β',
    negativePrompt: '噪声',
    model: '模型 V2',
    source: '本地生成器',
    seed,
    params: { steps: 32, seed, details: { sampler: 'Euler a', cfg: 8 } },
  });
  oldStore.createAnnotation(asset.id, {
    versionId: asset.currentVersionId,
    x: 0.75,
    y: 0.2,
    text: 'V2：定稿边缘',
  });
  oldStore.updateSettings({
    activeLibraryId: library.id,
    language: 'zh-CN',
    theme: 'light',
    layout: 'list',
  });
  await media.close();
  media = undefined;
  const baseline = {
    library: oldStore.getLibrary(library.id),
    roots: oldStore.listRoots(library.id),
    asset: oldStore.getAsset(asset.id),
    versions: oldStore.listVersions(asset.id),
    folders: oldStore.listFolders(library.id),
    groups: oldStore.listTagGroups(library.id),
    tags: oldStore.listTags(library.id),
    annotations: oldStore.listAnnotations(asset.id),
    settings: oldStore.getSettings(),
  };
  assert.equal(baseline.versions.length, 2);
  assert.equal(baseline.asset.finalized, true);
  assert.equal(baseline.asset.note, '保留注释、层级与定稿状态。');
  assert.equal(baseline.asset.folderId, folder.id);
  assert.deepEqual(
    baseline.asset.tags.map((entry) => entry.id),
    [tag.id],
  );
  assert.equal(baseline.asset.rating, 5);
  assert.equal(baseline.annotations.length, 2);
  assert.equal(baseline.folders.length, 2);
  assert.equal(
    baseline.versions.find((entry) => entry.id === firstVersion).prompt,
    '初版提示词 α',
  );
  assert.equal(baseline.asset.prompt, '终版提示词 β');

  const versionHashes = await Promise.all(
    baseline.versions.map(async (version) => ({
      id: version.id,
      ordinal: version.ordinal,
      sha256: sha256(
        await readFile(oldStore.getVersionFile(version.id).snapshotPath),
      ),
    })),
  );
  assert.equal(
    versionHashes.find((entry) => entry.id === firstVersion).sha256,
    sha256(originalBytes),
  );
  assert.equal(
    versionHashes.find((entry) => entry.id === asset.currentVersionId).sha256,
    sha256(replacementBytes),
  );
  const oldMigrations = migrationRows(database);
  database.sqlite.pragma('wal_checkpoint(TRUNCATE)');
  database.close();
  database = undefined;
  await cp(paths.data, join(fixture, 'closed-v0.1.0-backup'), {
    recursive: true,
  });
  checks.releasedServicesCreatedFixture = true;
  checks.closedDatabaseBackupCreated = true;

  const [
    { openDatabase: openNext },
    { CatalogStore: NextCatalog },
    { ProcessStore },
    { BoardStore },
    { BrandStore },
  ] = await Promise.all([
    load(nextRoot, 'database.js'),
    load(nextRoot, 'catalog-store.js'),
    load(nextRoot, 'process/store.js'),
    load(nextRoot, 'boards/store.js'),
    load(nextRoot, 'brands/store.js'),
  ]);
  database = openNext(paths);
  let catalog = new NextCatalog(database);
  let processStore = new ProcessStore(database);
  assert.equal(migrationRows(database).length, 6);
  assert.deepEqual(migrationRows(database).slice(0, 3), oldMigrations);
  assert.equal(
    database.sqlite.pragma('integrity_check', { simple: true }),
    'ok',
  );
  assert.deepEqual(database.sqlite.pragma('foreign_key_check'), []);
  for (const [label, actual] of Object.entries({
    library: catalog.getLibrary(library.id),
    roots: catalog.listRoots(library.id),
    folders: catalog.listFolders(library.id),
    groups: catalog.listTagGroups(library.id),
    tags: catalog.listTags(library.id),
    annotations: catalog.listAnnotations(asset.id),
    settings: catalog.getSettings(),
  }))
    assert.deepEqual(
      actual,
      baseline[label],
      `${label} must survive unchanged`,
    );
  assert.deepEqual(
    oldFields(catalog.getAsset(asset.id), baseline.asset),
    baseline.asset,
  );
  for (const version of catalog.listVersions(asset.id))
    assert.deepEqual(
      oldFields(
        version,
        baseline.versions.find((entry) => entry.id === version.id),
      ),
      baseline.versions.find((entry) => entry.id === version.id),
    );
  checks.originalIdentitiesTimestampsMetadataAndRelationsPreserved = true;
  const generations = processStore.generations(library.id),
    selections = processStore.selections(library.id);
  assert.equal(generations.length, 2);
  assert(generations.every((entry) => entry.origin === 'legacy-backfill'));
  assert.deepEqual(
    generations.map((entry) => entry.id).sort(),
    baseline.versions.map((entry) => entry.id).sort(),
  );
  for (const version of catalog.listVersions(asset.id)) {
    assert.equal(version.generationId, version.id);
    assert.equal(version.seed, seed);
  }
  assert.equal(catalog.getAsset(asset.id).generationId, asset.currentVersionId);
  assert.equal(selections.length, 1);
  assert.deepEqual(
    {
      kind: selections[0].ownerKind,
      owner: selections[0].ownerId,
      asset: selections[0].assetId,
      version: selections[0].versionId,
    },
    {
      kind: 'manual',
      owner: asset.id,
      asset: asset.id,
      version: asset.currentVersionId,
    },
  );
  assert.equal(catalog.getAsset(asset.id).finalized, true);
  checks.uint64SeedPreservedAsString = true;
  checks.legacyGenerationsBackfilled = true;
  checks.manualFinalSelectionMigrated = true;
  const boards = new BoardStore(database),
    brands = new BrandStore(database);
  const presets = boards.listTemplates(library.id);
  assert.equal(presets.length, 4);
  let board = boards.createBoard(library.id, {
    name: '升级后角色矩阵',
    kind: 'matrix',
    matrixPreset: 'character-angle',
  });
  const pin = { assetId: asset.id, versionId: firstVersion },
    slot = board.slots[0];
  assert(slot);
  board = boards.assignSlot(slot.id, { expectedRevision: slot.revision, pin });
  let brand = brands.createBrand(library.id, { name: '升级后品牌 α' });
  brand = brands.saveBrand(brand.id, {
    expectedRevision: brand.revision,
    name: brand.name,
    guidelines: '# 品牌规范\n保留旧资产的固定版本。',
    colors: [{ name: '陶土橙', hex: '#f49245' }],
    fonts: [],
    logos: [{ name: '历史版本标识', pin }],
  });
  assert.equal(processStore.selections(library.id).length, 2);
  assert.equal(catalog.getAsset(asset.id).finalized, true);
  assert.deepEqual(boards.listSlotHistory(slot.id)[0].pin, pin);
  assert.deepEqual(brand.logos[0].pin, pin);
  checks.newBoardAndBrandUseRetainedVersions = true;
  checks.slotAndManualFinalOwnersRemainIndependent = true;
  const expectedDigest = logicalDigest(database),
    expectedMigrations = migrationRows(database);
  database.close();
  database = undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    database = openNext(paths);
    catalog = new NextCatalog(database);
    processStore = new ProcessStore(database);
    assert.equal(logicalDigest(database), expectedDigest);
    assert.deepEqual(migrationRows(database), expectedMigrations);
    assert.deepEqual(processStore.generations(library.id), generations);
    assert.deepEqual(new BoardStore(database).getBoard(board.board.id), board);
    assert.deepEqual(new BrandStore(database).getBrand(brand.id), brand);
    assert.equal(catalog.getAsset(asset.id).seed, seed);
    assert.equal(processStore.selections(library.id).length, 2);
    for (const version of versionHashes)
      assert.equal(
        sha256(await readFile(catalog.getVersionFile(version.id).snapshotPath)),
        version.sha256,
      );
    assert.equal(sha256(await readFile(original)), sha256(originalBytes));
    assert.equal(
      database.sqlite.pragma('integrity_check', { simple: true }),
      'ok',
    );
    assert.deepEqual(database.sqlite.pragma('foreign_key_check'), []);
    database.close();
    database = undefined;
  }
  checks.twoReopensIdempotentWithoutDuplicateBackfill = true;
  checks.originalAndRetainedVersionBytesUnchanged = true;
  checks.sqliteIntegrityAndForeignKeys = true;
  const evidence = {
    status: 'passed',
    verifiedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    scope:
      'Real released v0.1.0 services and SQL migrations, then P1 services and SQL migrations; synthetic private temporary data only.',
    source: {
      release: 'v0.1.0',
      packageVersion: JSON.parse(
        await readFile(join(oldRoot, 'package.json'), 'utf8'),
      ).version,
      migrations: await migrations(oldRoot),
    },
    target: {
      milestone: 'v0.2.0 candidate',
      migrations: await migrations(nextRoot),
    },
    fixture: {
      libraryName: library.name,
      relativeOriginal: '方案 α/角色 初稿.png',
      assetId: asset.id,
      libraryId: library.id,
      rootId: root.id,
      currentVersionId: asset.currentVersionId,
      versionCount: 2,
      annotationCount: 2,
      folderCount: 2,
      tagCount: 1,
      exactSeed: seed,
      manualFinalized: true,
      originalSha256: sha256(originalBytes),
      versions: versionHashes,
    },
    upgrade: {
      migrationCounts: { before: 3, after: 6, afterReopen: 6 },
      generationCount: generations.length,
      generationOrigins: [...new Set(generations.map((entry) => entry.origin))],
      finalOwnersAfterNewSlot: ['manual', 'slot'],
      newBoard: {
        id: board.board.id,
        kind: board.board.kind,
        rows: board.board.rows.length,
        columns: board.board.columns.length,
        slots: board.slots.length,
      },
      newBrand: {
        id: brand.id,
        colorCount: brand.colors.length,
        logoCount: brand.logos.length,
      },
      idempotentReopens: 2,
      logicalDigestAfterDomainWrites: expectedDigest,
    },
    checks,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(
    JSON.stringify({
      status: 'passed',
      checks: Object.keys(checks).length,
      migrations: '3 -> 6',
      versions: 2,
      reopens: 2,
    }),
  );
} finally {
  await media?.close();
  database?.close();
  await rm(fixture, { recursive: true, force: true });
}
