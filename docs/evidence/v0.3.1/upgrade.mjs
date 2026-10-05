// Run with Node 22 against separately built exact v0.3.0 and v0.3.1 sources.
// All mutable data is generated in a private temporary directory and removed.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

const [oldArgument, nextArgument, outputArgument, mode] = process.argv.slice(2);
assert(mode === undefined || mode === '--fixture-only', 'Unknown mode');
const fixtureOnly = mode === '--fixture-only';
assert(
  oldArgument && nextArgument && outputArgument,
  'Usage: node upgrade.mjs V030_BUILT_ROOT V031_BUILT_ROOT OUTPUT_JSON',
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
const git = (root, ...args) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const sourceCommit = git(oldRoot, 'rev-parse', 'HEAD');
assert.equal(sourceCommit, git(oldRoot, 'rev-parse', 'v0.3.0^{commit}'));
assert.equal(sourceCommit, 'd90a567fbfe8989241bce8e65db27ffc31640c66');
for (const root of [oldRoot, nextRoot])
  git(root, 'diff', '--exit-code', 'HEAD', '--', 'packages', 'pnpm-lock.yaml');
const targetCommit = git(nextRoot, 'rev-parse', 'HEAD');
for (const name of [
  'package.json',
  'packages/shared/package.json',
  'packages/server/package.json',
  'packages/web/package.json',
]) {
  assert.equal(
    JSON.parse(await readFile(join(oldRoot, name), 'utf8')).version,
    '0.3.0',
  );
  if (!fixtureOnly)
    assert.equal(
      JSON.parse(await readFile(join(nextRoot, name), 'utf8')).version,
      '0.3.1',
    );
}
assert.equal(process.versions.node.split('.')[0], '22');
const fixture = await mkdtemp(join(tmpdir(), 'cura-v030-v031-upgrade-'));
const paths = {
  data: join(fixture, 'data'),
  cache: join(fixture, 'cache'),
  log: join(fixture, 'log'),
};
const originalDirectory = join(fixture, '原始参考');
const originalRelative = join('方案 α', '角色 e\u0301 初稿.png');
const original = join(originalDirectory, originalRelative);
const originalBytes = png(70, '中文初稿，柔和光线');
const replacementBytes = png(210, '中文终稿，清晰轮廓');
const checks = {};
let database, media, generationService, automation;
const migrationRows = (db) =>
  db.sqlite.prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all();
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const stableRows = (rows) =>
  rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
function tables(db) {
  return db.sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'__drizzle_migrations' ORDER BY name",
    )
    .all()
    .map(({ name }) => name);
}
function snapshotTables(db, names = tables(db), columns) {
  return Object.fromEntries(
    names.map((name) => [
      name,
      stableRows(
        db.sqlite
          .prepare(
            `SELECT ${columns?.[name]?.map(quote).join(',') ?? '*'} FROM ${quote(name)}`,
          )
          .all(),
      ),
    ]),
  );
}
const logicalDigest = (db) => sha256(JSON.stringify(snapshotTables(db)));
async function migrationFiles(root) {
  const journal = JSON.parse(
    await readFile(
      join(root, 'packages/server/drizzle/meta/_journal.json'),
      'utf8',
    ),
  );
  return Promise.all(
    journal.entries.map(async ({ tag }) => ({
      tag,
      sha256: sha256(
        await readFile(join(root, 'packages/server/drizzle', `${tag}.sql`)),
      ),
    })),
  );
}
async function waitFor(read, accept, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((done) => setTimeout(done, 20));
  }
  assert.fail(`${label} timed out`);
}
const node = (kind, fields = {}) => ({
  id: randomUUID(),
  kind,
  x: 120,
  y: 200,
  width: 240,
  height: 180,
  groupId: null,
  label: kind,
  text: '',
  assetId: null,
  versionId: null,
  ...fields,
});
try {
  const [
    { openDatabase: openOld },
    { CatalogStore: OldCatalog },
    { MediaService: OldMedia },
    { BoardStore: OldBoards },
    { BrandStore: OldBrands, readBrandExport: oldBrandExport },
    { ProcessStore: OldProcess, readProcessExport: oldProcessExport },
    { GenerationService: OldGeneration },
    { AutomationService: OldAutomation },
    { readAutomationExport: oldAutomationExport },
  ] = await Promise.all([
    load(oldRoot, 'database.js'),
    load(oldRoot, 'catalog-store.js'),
    load(oldRoot, 'media/service.js'),
    load(oldRoot, 'boards/store.js'),
    load(oldRoot, 'brands/store.js'),
    load(oldRoot, 'process/store.js'),
    load(oldRoot, 'process/service.js'),
    load(oldRoot, 'automation/service.js'),
    load(oldRoot, 'automation/export.js'),
  ]);
  await mkdir(dirname(original), { recursive: true });
  await writeFile(original, originalBytes);
  database = openOld(paths);
  const catalog = new OldCatalog(database);
  const boards = new OldBoards(database),
    brands = new OldBrands(database);
  const processStore = new OldProcess(database);
  media = new OldMedia(catalog, paths);
  assert.equal(migrationRows(database).length, 9);
  const library = catalog.createLibrary({
    name: '升级验证 · 设计资料 e\u0301',
  });
  const root = await media.registerRoot(library.id, originalDirectory);
  let asset = await waitFor(
    () => catalog.listAssets(library.id).items[0],
    Boolean,
    'Released reference import',
  );
  assert.equal(
    asset.relativePath,
    originalRelative.replaceAll('\\', '/').normalize('NFC'),
  );
  assert.equal(asset.seed, seed);
  const firstPin = { assetId: asset.id, versionId: asset.currentVersionId };
  const duplicateDirectory = join(fixture, '重复参考');
  await mkdir(duplicateDirectory);
  await writeFile(join(duplicateDirectory, '另一个别名.png'), originalBytes);
  const duplicateRoot = await media.registerRoot(
    library.id,
    duplicateDirectory,
  );
  await waitFor(
    () => catalog.getSource(duplicateRoot.id, '另一个别名.png'),
    Boolean,
    'Released duplicate source',
  );
  assert.equal(catalog.listAssets(library.id).total, 1);
  const offlineDirectory = join(fixture, '离线参考');
  await mkdir(offlineDirectory);
  await writeFile(
    join(offlineDirectory, '保留离线.png'),
    png(40, '保留离线资料'),
  );
  const offlineRoot = await media.registerRoot(library.id, offlineDirectory);
  const offlineSource = await waitFor(
    () => catalog.getSource(offlineRoot.id, '保留离线.png'),
    Boolean,
    'Released offline source',
  );
  await media.unregisterRoot(offlineRoot.id);
  catalog.updateAsset(offlineSource.assetId, {
    displayName: '离线历史资料',
    archivedAt: new Date().toISOString(),
  });
  assert.equal(catalog.getAsset(offlineSource.assetId).missing, true);

  const group = catalog.createTagGroup(library.id, {
    name: '材质与情绪 e\u0301',
  });
  const tag = catalog.createTag(library.id, {
    name: '暖色 e\u0301',
    color: '#f49245',
    groupId: group.id,
  });
  const parent = catalog.createFolder(library.id, {
    name: '研发',
    parentId: null,
  });
  const folder = catalog.createFolder(library.id, {
    name: '角色 / 方案',
    parentId: parent.id,
  });
  catalog.updateAsset(asset.id, {
    folderId: folder.id,
    tagIds: [tag.id],
    rating: 5,
    note: '保留注释、层级与历史定稿。',
    prompt: '初版提示词 α',
    negativePrompt: '模糊',
    model: '模型 V1',
    source: '本地生成器',
    seed,
    params: { steps: 28, seed, nested: { sampler: 'Euler', cfg: 7 } },
  });
  catalog.createAnnotation(asset.id, {
    versionId: firstPin.versionId,
    x: 0.25,
    y: 0.6,
    text: 'V1：保留阴影细节',
  });
  asset = await media.replace(asset.id, '角色 终稿 V2.png', replacementBytes);
  const secondPin = { assetId: asset.id, versionId: asset.currentVersionId };
  assert.notEqual(firstPin.versionId, secondPin.versionId);
  catalog.updateAsset(asset.id, {
    finalized: true,
    prompt: '终版提示词 β',
    negativePrompt: '噪声',
    model: '模型 V2',
    source: '本地生成器',
    seed,
    params: { steps: 32, seed, nested: { sampler: 'Euler a', cfg: 8 } },
  });
  catalog.createAnnotation(asset.id, {
    versionId: secondPin.versionId,
    x: 0.75,
    y: 0.2,
    text: 'V2：定稿边缘',
  });
  catalog.createCollection(library.id, {
    name: '暖色高分',
    rules: { tagId: tag.id, rating: 5 },
  });
  catalog.updateSettings({
    activeLibraryId: library.id,
    language: 'zh-CN',
    theme: 'light',
    layout: 'list',
  });

  const presets = boards.listTemplates(library.id);
  assert.equal(presets.length, 4);
  const template = boards.createTemplate(library.id, {
    name: '自定义模板',
    slots: [
      { key: 'hero', label: '历史角色', x: 20, y: 40, width: 280, height: 200 },
    ],
  });
  let canvas = boards.createBoard(library.id, {
    name: '角色画布 e\u0301',
    templateId: template.id,
  });
  const canvasSlot = canvas.slots[0];
  canvas = boards.assignSlot(canvasSlot.id, {
    expectedRevision: 0,
    pin: secondPin,
  });
  canvas = boards.assignSlot(canvasSlot.id, {
    expectedRevision: 1,
    pin: firstPin,
  });
  const frame = node('group', { width: 800, height: 600 });
  const imageNode = node('asset', { ...secondPin, groupId: frame.id });
  const noteNode = node('text', { text: '中文构图备注', x: 450 });
  canvas = boards.saveLayout(canvas.board.id, {
    expectedRevision: canvas.board.revision,
    items: [frame, imageNode, noteNode],
    edges: [
      {
        id: randomUUID(),
        sourceId: imageNode.id,
        targetId: noteNode.id,
        label: '对照',
      },
    ],
    viewport: { x: -123, y: 87, zoom: 1.5 },
  });
  boards.deleteTemplate(template.id);
  const rows = [
    { id: randomUUID(), label: '角色甲' },
    { id: randomUUID(), label: '角色乙' },
  ];
  const columns = [
    { id: randomUUID(), label: '正面' },
    { id: randomUUID(), label: '35°' },
  ];
  let matrix = boards.createBoard(library.id, {
    name: '角色 × 角度',
    kind: 'matrix',
    rows,
    columns,
  });
  const cell = matrix.slots.find(
    (slot) => slot.rowId === rows[0].id && slot.columnId === columns[0].id,
  );
  matrix = boards.assignSlot(cell.id, { expectedRevision: 0, pin: secondPin });
  matrix = boards.assignSlot(cell.id, { expectedRevision: 1, pin: firstPin });
  matrix = boards.updateBoard(matrix.board.id, {
    expectedRevision: matrix.board.revision,
    rows: [rows[1], { ...rows[0], label: '角色甲修订' }],
    columns: [columns[1], columns[0]],
  });
  matrix = boards.updateBoard(matrix.board.id, {
    expectedRevision: matrix.board.revision,
    columns: [columns[0]],
  });
  assert.equal(
    matrix.slots.find((slot) => slot.id === cell.id).currentPin.versionId,
    firstPin.versionId,
  );

  const fontTest = await readFile(join(oldRoot, 'e2e/brands.spec.ts'), 'utf8');
  const fontLiteral =
    /const fontBytes = Buffer\.from\(\s*'([A-Za-z0-9+/=]+)'/u.exec(fontTest);
  assert(fontLiteral, 'Released original MIT triangle-font fixture must exist');
  const fontBytes = Buffer.from(fontLiteral[1], 'base64');
  assert.equal(fontBytes.readUInt32BE(0), 0x00010000);
  const fontAsset = await media.upload(library.id, '测试字体.ttf', fontBytes);
  const fontPin = {
    assetId: fontAsset.id,
    versionId: fontAsset.currentVersionId,
  };
  const brand = brands.createBrand(library.id, { name: '中文品牌' });
  brands.saveBrand(brand.id, {
    expectedRevision: 0,
    name: brand.name,
    guidelines: '# 品牌规范\n保留颜色、字体和历史标识。',
    colors: [
      { name: '陶土橙', hex: '#f49245' },
      { name: '石墨黑', hex: '#202020' },
    ],
    fonts: [{ name: '原创三角字体', role: '标题', pin: fontPin }],
    logos: [
      { name: '初稿标识', pin: firstPin },
      { name: '终稿标识', pin: secondPin },
    ],
  });
  const cmf = brands.createCmfBoard(library.id, { name: '材质工艺' });
  brands.saveCmfBoard(cmf.id, {
    expectedRevision: 0,
    name: cmf.name,
    entries: [
      {
        name: '阳极铝',
        colorName: '陶土橙',
        hex: '#f49245',
        process: '喷砂后阳极氧化',
        pin: secondPin,
      },
    ],
  });
  const trashed = await media.upload(
    library.id,
    '回收站样本.png',
    png(130, '保留回收站'),
  );
  catalog.batchAssets(library.id, { assetIds: [trashed.id], action: 'trash' });
  generationService = new OldGeneration(processStore, catalog, media);
  const generationJob = generationService.start(library.id, {
    prompt: '离线过程样本',
    seed,
    width: 128,
    height: 96,
  });
  const completed = await waitFor(
    () => processStore.job(generationJob.id),
    (job) => job.status === 'completed',
    'Released mock generation',
  );
  assert.equal(
    catalog.getAsset(completed.assetIds[0]).id,
    completed.assetIds[0],
  );
  const failedJob = generationService.start(library.id, {
    prompt: '失败过程样本',
    mockOutcome: 'fail',
  });
  await waitFor(
    () => processStore.job(failedJob.id),
    (job) => job.status === 'failed',
    'Released failed generation',
  );
  await generationService.close();
  generationService = undefined;
  automation = new OldAutomation({
    database,
    store: catalog,
    media,
    paths,
    schedule: false,
  });
  const analysis = automation.analyze(library.id, {
    assetIds: [asset.id],
    providerId: 'metadata-rules',
  });
  await waitFor(
    () => automation.job(library.id, analysis.id),
    (job) => job.status === 'completed',
    'Released metadata automation',
  );
  const script = await automation.content.importScript(
    library.id,
    '升级剧本.fountain',
    Buffer.from('INT. 工坊 - DAY\n\n阿青\n保留原始剧本与角色。\n', 'utf8'),
  );
  const document = automation.content.createDocument(library.id, {
    title: '历史版本设定',
    pins: [firstPin],
    scriptId: script.id,
  });
  automation.createRule(library.id, {
    name: '保留归档规则',
    enabled: false,
    filters: { tagIds: [tag.id], olderThanDays: 30 },
  });
  await automation.close();
  automation = undefined;

  await media.close();
  media = undefined;

  const assetIds = database.sqlite
    .prepare('SELECT id FROM assets ORDER BY id')
    .all()
    .map(({ id }) => id);
  const baseline = {
    library: catalog.getLibrary(library.id),
    roots: catalog.listRoots(library.id),
    assets: assetIds.map((id) => catalog.getAsset(id)),
    versions: assetIds.flatMap((id) => catalog.listVersions(id)),
    folders: catalog.listFolders(library.id),
    groups: catalog.listTagGroups(library.id),
    tags: catalog.listTags(library.id),
    collections: catalog.listCollections(library.id),
    annotations: assetIds.flatMap((id) => catalog.listAnnotations(id)),
    settings: catalog.getSettings(),
    boards: boards.exportLibrary(library.id),
    brands: oldBrandExport(database, library.id),
    process: oldProcessExport(database, library.id),
    statistics: processStore.statistics(library.id),
    timeline: processStore.timeline(asset.id),
    automation: oldAutomationExport(database, library.id),
  };
  assert.equal(baseline.assets.length, 6);
  assert.equal(baseline.versions.length, 7);
  assert.equal(baseline.process.finalSelections.length, 3);
  assert.deepEqual(
    boards.listSlotHistory(canvasSlot.id).map((revision) => revision.pin),
    [firstPin, secondPin],
  );
  assert.equal(
    baseline.boards.slots.filter((slot) => slot.deletedAt).length,
    2,
  );
  assert.equal(
    baseline.boards.templates.filter((item) => item.deletedAt).length,
    1,
  );
  assert.equal(baseline.process.jobs.length, 2);
  assert.equal(baseline.library.name, '升级验证 · 设计资料 é');
  assert.equal(baseline.tags[0].name, '暖色 é');
  const versionHashes = await Promise.all(
    baseline.versions.map(async (version) => {
      const path = catalog.getVersionFile(version.id).snapshotPath;
      const hash = sha256(await readFile(path));
      assert.equal(hash, version.hash);
      return {
        id: version.id,
        assetId: version.assetId,
        ordinal: version.ordinal,
        sha256: hash,
        relativePath: relative(paths.data, path),
      };
    }),
  );
  const sourceHashes = await Promise.all(
    database.sqlite
      .prepare(
        'SELECT s.id,s.actual_relative_path,s.last_hash,r.path FROM asset_sources s JOIN library_roots r ON r.id=s.root_id ORDER BY s.id',
      )
      .all()
      .map(async (source) => {
        const path = join(source.path, source.actual_relative_path);
        const hash = sha256(await readFile(path));
        assert.equal(hash, source.last_hash);
        return { id: source.id, path, sha256: hash };
      }),
  );
  const oldTables = tables(database);
  const oldColumns = Object.fromEntries(
    oldTables.map((name) => [
      name,
      database.sqlite
        .prepare(`PRAGMA table_info(${quote(name)})`)
        .all()
        .map((column) => column.name),
    ]),
  );
  const oldRows = snapshotTables(database, oldTables, oldColumns);
  const oldMigrations = migrationRows(database);
  database.sqlite.pragma('wal_checkpoint(TRUNCATE)');
  database.close();
  database = undefined;
  const backup = join(fixture, 'closed-v0.3.0-backup');
  await cp(paths.data, backup, { recursive: true });
  assert.equal(
    sha256(await readFile(join(backup, 'cura.sqlite'))),
    sha256(await readFile(join(paths.data, 'cura.sqlite'))),
  );
  for (const version of versionHashes)
    assert.equal(
      sha256(await readFile(join(backup, version.relativePath))),
      version.sha256,
    );
  checks.exactTaggedV030ServicesCreatedFixture = true;
  checks.closedBackupDatabaseAndRetainedBytesVerified = true;

  if (fixtureOnly) {
    const prepared = {
      status: 'fixture-prepared-only',
      verifiedAt: new Date().toISOString(),
      sourceCommit,
      migrationCount: oldMigrations.length,
      assetCount: baseline.assets.length,
      versionCount: baseline.versions.length,
      legacyTables: oldTables.length,
      checks,
    };
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(prepared, null, 2) + '\n');
    console.log(JSON.stringify(prepared));
  } else {
    const [
      { openDatabase: openNext },
      { CatalogStore: NextCatalog },
      { BoardStore: NextBoards },
      { readBrandExport: nextBrandExport },
      { ProcessStore: NextProcess, readProcessExport: nextProcessExport },
      { readAutomationExport: nextAutomationExport },
    ] = await Promise.all([
      load(nextRoot, 'database.js'),
      load(nextRoot, 'catalog-store.js'),
      load(nextRoot, 'boards/store.js'),
      load(nextRoot, 'brands/store.js'),
      load(nextRoot, 'process/store.js'),
      load(nextRoot, 'automation/export.js'),
    ]);
    database = openNext(paths);
    let nextCatalog = new NextCatalog(database);
    assert.equal(migrationRows(database).length, 10);
    assert.deepEqual(migrationRows(database).slice(0, 9), oldMigrations);
    assert.deepEqual(snapshotTables(database, oldTables, oldColumns), oldRows);
    assert.deepEqual(
      tables(database).filter((name) => !oldTables.includes(name)),
      ['root_scan_summaries'],
    );
    assert.equal(
      database.sqlite
        .prepare('SELECT count(*) AS count FROM root_scan_summaries')
        .get().count,
      0,
    );
    checks.nineToTenMigrationsPreserveJournal = true;
    checks.everyLegacyRowIdColumnTimestampAndFtsUnchanged = true;
    checks.newOperationalScanTableStartsEmpty = true;

    const current = {
      library: nextCatalog.getLibrary(library.id),
      roots: nextCatalog.listRoots(library.id),
      assets: assetIds.map((id) => nextCatalog.getAsset(id)),
      versions: assetIds.flatMap((id) => nextCatalog.listVersions(id)),
      folders: nextCatalog.listFolders(library.id),
      groups: nextCatalog.listTagGroups(library.id),
      tags: nextCatalog.listTags(library.id),
      collections: nextCatalog.listCollections(library.id),
      annotations: assetIds.flatMap((id) => nextCatalog.listAnnotations(id)),
      settings: nextCatalog.getSettings(),
      boards: new NextBoards(database).exportLibrary(library.id),
      brands: nextBrandExport(database, library.id),
      process: nextProcessExport(database, library.id),
      statistics: new NextProcess(database).statistics(library.id),
      timeline: new NextProcess(database).timeline(asset.id),
      automation: nextAutomationExport(database, library.id),
    };
    // New additive response fields are allowed; every previously visible field must remain exact.
    function assertLegacy(actual, expected, label) {
      if (Array.isArray(expected)) {
        assert.equal(actual.length, expected.length, label);
        expected.forEach((value, index) =>
          assertLegacy(actual[index], value, `${label}[${index}]`),
        );
      } else if (expected && typeof expected === 'object') {
        for (const [key, value] of Object.entries(expected))
          assertLegacy(actual[key], value, `${label}.${key}`);
      } else assert.deepEqual(actual, expected, label);
    }
    assertLegacy(current, baseline, 'released reader');
    assert.equal(
      nextCatalog.getAsset(asset.id).currentVersionId,
      secondPin.versionId,
    );
    assert.equal(
      nextCatalog.getSource(
        root.id,
        originalRelative.replaceAll('\\', '/').normalize('NFC'),
      ).lastHash,
      sha256(originalBytes),
    );
    assert.equal(nextCatalog.getAsset(offlineSource.assetId).missing, true);
    assert.deepEqual(
      new NextBoards(database)
        .listSlotHistory(canvasSlot.id)
        .map((revision) => revision.pin),
      [firstPin, secondPin],
    );
    assert.equal(
      nextCatalog.listAssets(library.id, { trash: true }).items[0].id,
      trashed.id,
    );
    checks.manualReplacementAndSourceLastHashesPreserved = true;
    checks.aliasesRemovedRootsInboxTrashArchiveAndSettingsPreserved = true;
    checks.generationIdsExactSeedsAnnotationsAndHistoricalFinalPinsPreserved = true;
    checks.boardMatrixTemplateBrandAndAutomationHistoryPreserved = true;

    // Exercise only the new operational store so the legacy-table comparison stays strict.
    assert.equal(nextCatalog.scanStore.get(root.id), undefined);
    const running = nextCatalog.scanStore.start(nextCatalog.getRoot(root.id));
    const finishedAt = new Date(
      Math.max(Date.now(), Date.parse(running.startedAt)),
    ).toISOString();
    const complete = {
      ...running,
      status: 'completed',
      phase: 'finished',
      finishedAt,
      updatedAt: finishedAt,
      filesFound: 1,
      supportedFound: 1,
      processed: 1,
      succeeded: 1,
      extensions: [
        {
          extension: '.png',
          found: 1,
          supported: 1,
          existingGeneric: 0,
          skipped: 0,
          readErrors: 0,
        },
      ],
    };
    assert.equal(nextCatalog.scanStore.save(complete), true);
    assert.equal(nextCatalog.scanStore.save(running), false);
    assert.deepEqual(nextCatalog.scanStore.get(root.id), complete);
    assert.deepEqual(snapshotTables(database, oldTables, oldColumns), oldRows);
    checks.scanSummaryPersistsAndRejectsLateWritesWithoutLegacyMutation = true;
    const expectedDigest = logicalDigest(database);
    const upgradedJournal = migrationRows(database);
    const health = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      database.close();
      database = openNext(paths);
      nextCatalog = new NextCatalog(database);
      assert.equal(logicalDigest(database), expectedDigest);
      assert.deepEqual(migrationRows(database), upgradedJournal);
      assert.deepEqual(
        snapshotTables(database, oldTables, oldColumns),
        oldRows,
      );
      assert.deepEqual(nextCatalog.scanStore.get(root.id), complete);
      for (const version of versionHashes)
        assert.equal(
          sha256(
            await readFile(nextCatalog.getVersionFile(version.id).snapshotPath),
          ),
          version.sha256,
        );
      for (const source of sourceHashes)
        assert.equal(sha256(await readFile(source.path)), source.sha256);
      assert.equal(
        database.sqlite.pragma('integrity_check', { simple: true }),
        'ok',
      );
      assert.deepEqual(database.sqlite.pragma('foreign_key_check'), []);
      health.push({
        reopen: attempt + 1,
        migrationCount: migrationRows(database).length,
        logicalDigest: logicalDigest(database),
        integrity: 'ok',
        foreignKeyViolations: 0,
      });
    }
    checks.twoReopensIdempotentAcrossAllTables = true;
    checks.originalSourcesAndRetainedBytesUnchanged = true;
    checks.sqliteIntegrityAndForeignKeys = true;
    const sourceMigrations = await migrationFiles(oldRoot),
      targetMigrations = await migrationFiles(nextRoot);
    assert.equal(sourceMigrations.length, 9);
    assert.equal(targetMigrations.length, 10);
    assert.deepEqual(targetMigrations.slice(0, 9), sourceMigrations);
    const evidence = {
      status: 'passed',
      verifiedAt: new Date().toISOString(),
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      scope:
        'Actual exact-tagged v0.3.0 services create private synthetic data; v0.3.1 applies real Drizzle migrations. No browser, physical desktop, hosted cloud or model inference claim.',
      source: {
        release: 'v0.3.0',
        commit: sourceCommit,
        serverSourceTree: git(oldRoot, 'rev-parse', 'HEAD:packages/server/src'),
        sharedSourceTree: git(oldRoot, 'rev-parse', 'HEAD:packages/shared/src'),
        migrations: sourceMigrations,
      },
      target: {
        milestone: 'v0.3.1 candidate',
        commit: targetCommit,
        serverSourceTree: git(
          nextRoot,
          'rev-parse',
          'HEAD:packages/server/src',
        ),
        sharedSourceTree: git(
          nextRoot,
          'rev-parse',
          'HEAD:packages/shared/src',
        ),
        migrations: targetMigrations,
      },
      fixture: {
        libraryId: library.id,
        exactSeed: seed,
        assetCount: baseline.assets.length,
        versionCount: baseline.versions.length,
        rootCount: oldRows.library_roots.length,
        removedRootCount: oldRows.library_roots.filter((row) => row.removed_at)
          .length,
        annotationCount: baseline.annotations.length,
        boardCount: baseline.boards.boards.length,
        slotRevisionCount: baseline.boards.revisions.length,
        finalOwnerCount: baseline.process.finalSelections.length,
        automationJobs: baseline.automation.jobs.length,
        scripts: baseline.automation.scripts.length,
        settingDocuments: baseline.automation.documents.length,
        scriptId: script.id,
        documentId: document.id,
        versions: versionHashes.map(({ id, assetId, ordinal, sha256 }) => ({
          id,
          assetId,
          ordinal,
          sha256,
        })),
        originalSources: sourceHashes.map(({ id, sha256 }) => ({ id, sha256 })),
      },
      upgrade: {
        migrationCounts: { before: 9, after: 10, afterReopens: [10, 10] },
        legacyTablesCompared: oldTables.map((name) => ({
          name,
          columns: oldColumns[name].length,
          rows: oldRows[name].length,
        })),
        newSummaryId: complete.scanId,
        idempotentReopens: health,
      },
      checks,
    };
    const serialized = JSON.stringify(evidence, null, 2) + '\n';
    for (const privatePath of [fixture, oldRoot, nextRoot])
      assert(!serialized.includes(privatePath));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, serialized);
    console.log(
      JSON.stringify({
        status: 'passed',
        checks: Object.keys(checks).length,
        migrations: '9 -> 10',
        legacyTables: oldTables.length,
        versions: versionHashes.length,
        reopens: 2,
      }),
    );
  }
} finally {
  await automation?.close();
  await generationService?.close();
  await media?.close();
  database?.close();
  await rm(fixture, { recursive: true, force: true });
}
