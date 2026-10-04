// Run with Node 22 against two separately built Cura source directories.
// All mutable data is generated in a private temporary directory and removed.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

const [oldArgument, nextArgument, outputArgument] = process.argv.slice(2);
assert(
  oldArgument && nextArgument && outputArgument,
  'Usage: node verify-upgrade.mjs V020_BUILT_ROOT P2_BUILT_ROOT OUTPUT_JSON',
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
assert.equal(sourceCommit, git(oldRoot, 'rev-parse', 'v0.2.0^{commit}'));
assert.equal(sourceCommit, '571955275d7d5c3018aa9f340453f98229e518fd');
for (const root of [oldRoot, nextRoot])
  git(root, 'diff', '--exit-code', 'HEAD', '--', 'packages', 'pnpm-lock.yaml');
const targetCommit = git(nextRoot, 'rev-parse', 'HEAD');
assert.equal(process.versions.node.split('.')[0], '22');
const fixture = await mkdtemp(join(tmpdir(), 'cura-v020-p2-upgrade-'));
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
let database, media, generationService, app;
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
const legacyFields = (value, baseline) =>
  Object.fromEntries(Object.keys(baseline).map((key) => [key, value[key]]));
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
  ] = await Promise.all([
    load(oldRoot, 'database.js'),
    load(oldRoot, 'catalog-store.js'),
    load(oldRoot, 'media/service.js'),
    load(oldRoot, 'boards/store.js'),
    load(oldRoot, 'brands/store.js'),
    load(oldRoot, 'process/store.js'),
    load(oldRoot, 'process/service.js'),
  ]);
  await mkdir(dirname(original), { recursive: true });
  await writeFile(original, originalBytes);
  database = openOld(paths);
  const catalog = new OldCatalog(database);
  const boards = new OldBoards(database),
    brands = new OldBrands(database);
  const processStore = new OldProcess(database);
  media = new OldMedia(catalog, paths);
  assert.equal(migrationRows(database).length, 6);
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
  let brand = brands.createBrand(library.id, { name: '中文品牌' });
  brand = brands.saveBrand(brand.id, {
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
  let cmf = brands.createCmfBoard(library.id, { name: '材质工艺' });
  cmf = brands.saveCmfBoard(cmf.id, {
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
  const generated = catalog.getAsset(completed.assetIds[0]);
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
  };
  assert.equal(baseline.assets.length, 4);
  assert.equal(baseline.versions.length, 5);
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
  const backup = join(fixture, 'closed-v0.2.0-backup');
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
  checks.exactTaggedV020ServicesCreatedP0P1Fixture = true;
  checks.closedBackupDatabaseAndRetainedBytesVerified = true;

  const [
    { openDatabase: openNext },
    { CatalogStore: NextCatalog },
    { BoardStore: NextBoards },
    { BrandStore: NextBrands, readBrandExport: nextBrandExport },
    { ProcessStore: NextProcess, readProcessExport: nextProcessExport },
    { createApp },
    { readExportSnapshot },
  ] = await Promise.all([
    load(nextRoot, 'database.js'),
    load(nextRoot, 'catalog-store.js'),
    load(nextRoot, 'boards/store.js'),
    load(nextRoot, 'brands/store.js'),
    load(nextRoot, 'process/store.js'),
    load(nextRoot, 'app.js'),
    load(nextRoot, 'exports/snapshot.js'),
  ]);
  database = openNext(paths);
  let nextCatalog = new NextCatalog(database);
  assert.equal(migrationRows(database).length, 9);
  assert.deepEqual(migrationRows(database).slice(0, 6), oldMigrations);
  assert.deepEqual(snapshotTables(database, oldTables, oldColumns), oldRows);
  checks.allLegacyTableColumnsRowsAndTimestampsUnchanged = true;
  const current = {
    library: nextCatalog.getLibrary(library.id),
    roots: nextCatalog.listRoots(library.id),
    folders: nextCatalog.listFolders(library.id),
    groups: nextCatalog.listTagGroups(library.id),
    tags: nextCatalog.listTags(library.id),
    annotations: assetIds.flatMap((id) => nextCatalog.listAnnotations(id)),
    settings: nextCatalog.getSettings(),
    boards: new NextBoards(database).exportLibrary(library.id),
    brands: nextBrandExport(database, library.id),
    process: nextProcessExport(database, library.id),
    statistics: new NextProcess(database).statistics(library.id),
    timeline: new NextProcess(database).timeline(asset.id),
  };
  for (const [label, value] of Object.entries(current))
    assert.deepEqual(value, baseline[label], label);
  for (const old of baseline.assets) {
    const value = nextCatalog.getAsset(old.id);
    assert.deepEqual(legacyFields(value, old), old);
    assert.equal(value.displayName, null);
    assert.equal(value.archivedAt, null);
  }
  for (const old of baseline.versions)
    assert.deepEqual(
      nextCatalog
        .listVersions(old.assetId)
        .find((version) => version.id === old.id),
      old,
    );
  const collection = nextCatalog.listCollections(library.id)[0];
  assert.deepEqual(
    legacyFields(collection.rules, baseline.collections[0].rules),
    baseline.collections[0].rules,
  );
  assert.equal(collection.rules.archived, false);
  assert.equal(
    database.sqlite
      .prepare('SELECT count(*) AS count FROM library_roots WHERE managed<>0')
      .get().count,
    0,
  );
  assert.equal(nextCatalog.listAssets(library.id).total, 3);
  assert.equal(
    nextCatalog.listAssets(library.id, { trash: true }).items[0].id,
    trashed.id,
  );
  for (const table of tables(database).filter(
    (name) => !oldTables.includes(name),
  ))
    assert.equal(
      database.sqlite
        .prepare(`SELECT count(*) AS count FROM ${quote(table)}`)
        .get().count,
      0,
      table,
    );
  checks.sixToNineMigrationsPreserveOriginalJournal = true;
  checks.chineseNFCMetadataSeedsAnnotationsAndOrganizationPreserved = true;
  checks.historicalSlotAndManualFinalOwnersPreserved = true;
  checks.matrixAxisIdsDeletedCellsAndTemplateHistoryPreserved = true;
  checks.brandFontLogoColorAndCmfPinsPreserved = true;
  checks.processJobsGenerationIdsTimelineAndStatisticsPreserved = true;
  checks.displayNameArchiveAndManagedRootDefaultsCompatible = true;

  app = await createApp({ database, paths, staticRoot: false });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  assert(address && typeof address === 'object');
  const request = async (
    method,
    route,
    body,
    expectedStatus = 200,
    type = 'application/json',
  ) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': type },
      ...(body === undefined
        ? {}
        : { body: type === 'application/json' ? JSON.stringify(body) : body }),
    });
    const result = await response.json();
    assert.equal(
      response.status,
      expectedStatus,
      `${method} ${route}: ${JSON.stringify(result)}`,
    );
    return result;
  };
  await request('GET', '/api/health');
  const base = `/api/libraries/${library.id}`;
  const job = await request(
    'POST',
    `${base}/automation/jobs`,
    { assetIds: [asset.id], providerId: 'metadata-rules' },
    201,
  );
  await waitFor(
    () => request('GET', `${base}/automation/jobs/${job.id}`),
    (value) => value.status === 'completed',
    'Upgraded automation job',
  );
  const proposal = (
    await request('GET', `${base}/automation/proposals?jobId=${job.id}`)
  ).items[0];
  const nameChange = proposal.changes.find(
    (change) => change.field === 'displayName',
  );
  const apply = (value) => ({
    items: [
      {
        proposalId: proposal.id,
        expectedVersionId: secondPin.versionId,
        changes: [{ changeId: nameChange.id, expectedValue: value }],
      },
    ],
  });
  const applied = await request(
    'POST',
    `${base}/automation/proposals/apply`,
    apply(null),
  );
  assert.deepEqual(applied.conflicts, []);
  const actualName = applied.proposals[0].changes.find(
    (change) => change.id === nameChange.id,
  ).afterValue;
  const undone = await request(
    'POST',
    `${base}/automation/proposals/undo`,
    apply(actualName),
  );
  assert.deepEqual(undone.conflicts, []);
  await request('PATCH', `/api/assets/${asset.id}`, {
    displayName: '角色展示 e\u0301.png',
  });
  assert.equal(nextCatalog.getAsset(asset.id).displayName, '角色展示 é.png');
  await request('POST', `${base}/assets/batch`, {
    assetIds: [generated.id],
    action: 'archive',
  });
  assert.equal(
    (await request('GET', `${base}/assets?archived=true`)).items[0].id,
    generated.id,
  );
  await request('POST', `${base}/assets/batch`, {
    assetIds: [generated.id],
    action: 'unarchive',
  });
  await request(
    'POST',
    `${base}/assets/batch`,
    { assetIds: [generated.id, asset.id], action: 'archive' },
    409,
  );
  assert.equal(nextCatalog.getAsset(generated.id).archivedAt, null);
  assert.equal(nextCatalog.getAsset(asset.id).archivedAt, null);
  const scriptBytes = Buffer.from(
    '\ufeff场景：室内\r\n人物：阿岚\r\n道具：铜钥匙\r\n',
  );
  const script = await request(
    'POST',
    `${base}/automation/scripts?name=${encodeURIComponent('升级后剧本.fountain')}`,
    scriptBytes,
    201,
    'application/octet-stream',
  );
  assert.equal(script.entities.length, 3);
  assert.equal(script.entities[0].references[0].excerpt, '\ufeff场景：室内');
  const document = await request(
    'POST',
    `${base}/automation/documents`,
    {
      title: '升级后角色设定',
      language: 'zh-CN',
      pins: [firstPin],
      scriptId: script.id,
      entityIds: script.entities.map((entity) => entity.id),
    },
    201,
  );
  assert.equal(document.sources[0].prompt, '初版提示词 α');
  assert.equal(document.sources[0].hash, sha256(originalBytes));
  const exportedDocument = await request(
    'GET',
    `${base}/automation/documents/${document.id}/export?format=json`,
  );
  assert.deepEqual(exportedDocument, document);
  await app.close();
  app = undefined;
  checks.realLoopbackP2AutomationApplyUndoAndDisplayNameWork = true;
  checks.realLoopbackArchiveRestoreAndAtomicFinalProtectionWork = true;
  checks.realLoopbackUtf8ScriptAndHistoricalDocumentApisWork = true;
  const exported = readExportSnapshot(database, library.id, {
    scope: 'selection',
    assetIds: [generated.id],
  });
  assert(exported.manifest.includedDependencyAssetIds.includes(asset.id));
  assert(exported.manifest.includedDependencyAssetIds.includes(fontAsset.id));
  assert(
    exported.manifest.includedDependencyAssetIds.includes(
      script.sourcePin.assetId,
    ),
  );
  assert.deepEqual(exported.manifest.boards, baseline.boards);
  assert.deepEqual(exported.manifest.brands, baseline.brands);
  assert.equal(exported.manifest.automation.documents[0].id, document.id);
  for (const file of exported.files)
    assert.equal(sha256(await readFile(file.source)), file.hash);
  checks.neutralExportRetainsP1AndP2DependencyClosure = true;
  const afterDomainWrites = logicalDigest(database);
  const expectedMigrations = migrationRows(database);
  const finalSelections = new NextProcess(database).selections(library.id);
  const health = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    database.close();
    database = openNext(paths);
    nextCatalog = new NextCatalog(database);
    assert.equal(logicalDigest(database), afterDomainWrites);
    assert.deepEqual(migrationRows(database), expectedMigrations);
    assert.deepEqual(
      new NextProcess(database).selections(library.id),
      finalSelections,
    );
    assert.deepEqual(
      new NextBoards(database).exportLibrary(library.id),
      baseline.boards,
    );
    assert.deepEqual(new NextBrands(database).getBrand(brand.id), brand);
    assert.deepEqual(new NextBrands(database).getCmfBoard(cmf.id), cmf);
    for (const version of versionHashes)
      assert.equal(
        sha256(
          await readFile(nextCatalog.getVersionFile(version.id).snapshotPath),
        ),
        version.sha256,
      );
    for (const source of sourceHashes)
      assert.equal(sha256(await readFile(source.path)), source.sha256);
    assert.equal(sha256(await readFile(original)), sha256(originalBytes));
    assert.equal(
      nextCatalog.getAsset(asset.id).name,
      baseline.assets.find((item) => item.id === asset.id).name,
    );
    assert.equal(nextCatalog.getAsset(asset.id).seed, seed);
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
  checks.originalFontAndAllRetainedVersionBytesUnchanged = true;
  checks.sqliteIntegrityAndForeignKeys = true;
  const sourceMigrations = await migrationFiles(oldRoot),
    targetMigrations = await migrationFiles(nextRoot);
  assert.deepEqual(targetMigrations.slice(0, 6), sourceMigrations);
  const evidence = {
    status: 'passed',
    verifiedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    scope:
      'Actual tagged v0.2.0 services create synthetic private data; P2 applies SQL migrations and serves real loopback HTTP. No browser, physical desktop, hosted cloud, or model-inference claim.',
    source: {
      release: 'v0.2.0',
      commit: sourceCommit,
      serverSourceTree: git(oldRoot, 'rev-parse', 'HEAD:packages/server/src'),
      migrations: sourceMigrations,
    },
    target: {
      milestone: 'v0.3.0 candidate',
      commit: targetCommit,
      serverSourceTree: git(nextRoot, 'rev-parse', 'HEAD:packages/server/src'),
      migrations: targetMigrations,
    },
    fixture: {
      libraryName: library.name,
      libraryId: library.id,
      rootId: root.id,
      referencePathNFC: originalRelative.replaceAll('\\', '/').normalize('NFC'),
      originalSha256: sha256(originalBytes),
      fontSha256: sha256(fontBytes),
      exactSeed: seed,
      assetCount: baseline.assets.length,
      versionCount: versionHashes.length,
      annotationCount: baseline.annotations.length,
      boardCount: baseline.boards.boards.length,
      activeSlots: baseline.boards.slots.filter((slot) => !slot.deletedAt)
        .length,
      deletedSlots: baseline.boards.slots.filter((slot) => slot.deletedAt)
        .length,
      slotRevisionCount: baseline.boards.revisions.length,
      deletedTemplateCount: 1,
      brandCount: 1,
      cmfBoardCount: 1,
      processJobStatuses: baseline.process.jobs
        .map((item) => item.status)
        .sort(),
      finalOwners: baseline.process.finalSelections.map(
        ({ ownerKind, assetId, versionId }) => ({
          ownerKind,
          assetId,
          versionId,
        }),
      ),
      versions: versionHashes.map(({ id, assetId, ordinal, sha256 }) => ({
        id,
        assetId,
        ordinal,
        sha256,
      })),
      originalSources: sourceHashes.map(({ id, sha256 }) => ({ id, sha256 })),
    },
    upgrade: {
      migrationCounts: { before: 6, after: 9, afterReopens: [9, 9] },
      legacyTablesCompared: oldTables.map((name) => ({
        name,
        columns: oldColumns[name].length,
        rows: oldRows[name].length,
      })),
      newAutomationJobId: job.id,
      newScriptId: script.id,
      newDocumentId: document.id,
      exportedAssets: exported.manifest.assets.length,
      exportedVersions: exported.manifest.versions.length,
      idempotentReopens: health,
    },
    checks,
  };
  const serialized = JSON.stringify(evidence, null, 2) + '\n';
  assert(!serialized.includes(fixture));
  assert(!serialized.includes(oldRoot));
  assert(!serialized.includes(nextRoot));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, serialized);
  console.log(
    JSON.stringify({
      status: 'passed',
      checks: Object.keys(checks).length,
      migrations: '6 -> 9',
      legacyTables: oldTables.length,
      versions: versionHashes.length,
      reopens: 2,
    }),
  );
} finally {
  await app?.close();
  await generationService?.close();
  await media?.close();
  database?.close();
  await rm(fixture, { recursive: true, force: true });
}
