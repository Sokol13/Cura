import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

// Independent acceptance: only generated data beneath the explicit fixture directory.
// Usage: node slot-history-upgrade.mjs seed|verify <clean-built-source> <expected-commit> <fixture-dir>
const [mode, sourceArg, expectedCommit, fixtureArgument] =
  process.argv.slice(2);
assert.ok(
  fixtureArgument,
  'Pass a fresh fixture directory outside the source checkout',
);
const base = resolve(fixtureArgument);
assert.ok(['seed', 'verify'].includes(mode));
const source = resolve(sourceArg);
const git = (...args) =>
  execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
assert.equal(git('status', '--porcelain'), '', 'Use a clean committed runtime');
assert.equal(git('rev-parse', 'HEAD'), expectedCommit);
if (mode === 'seed')
  assert.equal(expectedCommit, 'a078429110b64e99b4358e709de6657f84ccd9ab');
for (const key of Object.keys(process.env))
  if (/^(CURA_|SUPABASE_|VITE_SUPABASE_)/.test(key)) delete process.env[key];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sorted = (rows) =>
  rows.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const load = (file) =>
  import(pathToFileURL(join(source, 'packages/server/dist', file)).href);
const [{ openDatabase }, { createApp }, { readPortableGraph, semanticHash }] =
  await Promise.all([
    load('database.js'),
    load('app.js'),
    load('sync/portable.js'),
  ]);
const identity = {
  commit: expectedCommit,
  node: process.version,
  platform: process.platform,
  runtimeTrees: Object.fromEntries(
    ['packages/server', 'packages/shared', 'pnpm-lock.yaml'].map((file) => [
      file,
      git('rev-parse', `HEAD:${file}`),
    ]),
  ),
  builtEntrypointSha256: hash(
    await readFile(join(source, 'packages/server/dist/app.js')),
  ),
};
const paths = Object.fromEntries(
  ['data', 'cache', 'log'].map((name) => [name, join(base, 'working', name)]),
);
const checks = [];
const check = (name, run) => {
  run();
  checks.push(name);
};
const json = async (file, value) =>
  writeFile(join(base, file), JSON.stringify(value, null, 2) + '\n');
const readJson = async (file) =>
  JSON.parse(await readFile(join(base, file), 'utf8'));
async function tree(root, current = root) {
  const result = [];
  for (const item of (await readdir(current, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const file = join(current, item.name);
    if (item.isDirectory()) result.push(...(await tree(root, file)));
    else {
      assert.ok(item.isFile());
      const bytes = await readFile(file);
      result.push({
        path: file.slice(root.length + 1),
        size: bytes.length,
        sha256: hash(bytes),
      });
    }
  }
  return result;
}
function chunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const header = Buffer.alloc(4),
    trailer = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  trailer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, bytes, trailer]);
}
function png(color, label) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk(
      'tEXt',
      Buffer.from(
        `parameters\0${label}\nNegative prompt: blur\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 42, Size: 1x1, Model: old-runtime-fixture`,
        'utf8',
      ),
    ),
    chunk('IDAT', deflateSync(Buffer.from([0, ...color, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
async function start() {
  const database = openDatabase(paths);
  const app = await createApp({ database, paths, staticRoot: false });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  async function raw(path, options = {}) {
    return fetch(`${origin}${path}`, {
      ...options,
      headers: { origin, ...options.headers },
      signal: AbortSignal.timeout(15_000),
    });
  }
  async function request(path, { method = 'GET', body, bytes } = {}) {
    const response = await raw(path, {
      method,
      headers: bytes
        ? { 'content-type': 'application/octet-stream' }
        : body === undefined
          ? {}
          : { 'content-type': 'application/json' },
      body: bytes ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const result = await response.json();
    assert.ok(
      response.ok,
      `${method} ${path} returned ${response.status}: ${JSON.stringify(result)}`,
    );
    return result;
  }
  return {
    app,
    database,
    request,
    raw,
    close: async () => {
      await app.close();
      database.close();
    },
  };
}
async function capture(database, libraryId) {
  const names = database.sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map(({ name }) => name);
  const tables = Object.fromEntries(
    names.map((name) => [
      name,
      sorted(
        database.sqlite
          .prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`)
          .all(),
      ),
    ]),
  );
  const files = [];
  for (const version of tables.asset_versions) {
    for (const [kind, path] of [
      ['retained', version.snapshot_path],
      ['thumbnail', version.thumbnail_path],
    ]) {
      if (!path) continue;
      const bytes = await readFile(path);
      const sha256 = hash(bytes);
      if (kind === 'retained')
        assert.equal(sha256, JSON.parse(version.payload).hash);
      files.push({ kind, id: version.id, size: bytes.length, sha256 });
    }
  }
  const records = readPortableGraph(database, libraryId).records;
  const integrity = database.sqlite.pragma('integrity_check');
  const foreignKeys = database.sqlite.pragma('foreign_key_check');
  assert.deepEqual(integrity, [{ integrity_check: 'ok' }]);
  assert.deepEqual(foreignKeys, []);
  return {
    tables,
    files: sorted(files),
    records,
    semanticHash: semanticHash(records),
    integrity,
    foreignKeys,
  };
}
async function versionsOverHttp(runtime, baseline) {
  for (const version of baseline.tables.asset_versions) {
    const response = await runtime.raw(`/api/versions/${version.id}/file`);
    assert.equal(response.status, 200);
    assert.equal(
      hash(Buffer.from(await response.arrayBuffer())),
      JSON.parse(version.payload).hash,
    );
  }
  checks.push(
    'Every retained V1/V2 downloads over real HTTP with its original SHA-256',
  );
}
function preserveLegacy(baseline, after, { newAssignment = false } = {}) {
  check(
    'Four immutable asset-version SQL rows and retained/thumbnail bytes stay exact',
    () => {
      assert.deepEqual(
        after.tables.asset_versions,
        baseline.tables.asset_versions,
      );
      assert.deepEqual(after.files, baseline.files);
    },
  );
  for (const table of ['folders', 'tags', 'asset_tags', 'annotations']) {
    check(`Authored ${table} SQL rows remain byte-for-byte unchanged`, () =>
      assert.deepEqual(after.tables[table], baseline.tables[table]),
    );
  }
  check(
    'All legacy slot revision fields remain exact and new actor column stays NULL',
    () => {
      for (const previous of baseline.tables.slot_revisions) {
        const next = after.tables.slot_revisions.find(
          (item) => item.id === previous.id,
        );
        assert.ok(next);
        assert.equal(next.actor_json, null);
        assert.deepEqual(
          Object.fromEntries(
            Object.keys(previous).map((key) => [key, next[key]]),
          ),
          previous,
        );
      }
    },
  );
  check(
    'Legacy portable history omits actor and presentation-only source',
    () => {
      const legacyIds = new Set(
        baseline.tables.slot_revisions.map((row) => row.id),
      );
      const revisions = after.records.find((record) => record.kind === 'board')
        .data.revisions;
      for (const revision of revisions.filter((row) => legacyIds.has(row.id))) {
        assert.equal(Object.hasOwn(revision, 'actor'), false);
        assert.equal(Object.hasOwn(revision, 'source'), false);
      }
    },
  );
  if (!newAssignment) {
    check(
      'Complete portable graph and semantic hash are unchanged on upgrade',
      () => {
        assert.deepEqual(after.records, baseline.records);
        assert.equal(after.semanticHash, baseline.semanticHash);
      },
    );
    for (const table of [
      'boards',
      'board_items',
      'board_edges',
      'slots',
      'final_selections',
    ]) {
      check(
        `Existing ${table} SQL state stays exact before new assignment`,
        () => assert.deepEqual(after.tables[table], baseline.tables[table]),
      );
    }
  } else {
    check(
      'New assignment preserves every old portable record except board state and affected asset updatedAt',
      () => {
        for (const record of baseline.records.filter(
          (row) => row.kind !== 'board',
        )) {
          const current = after.records.find(
            (row) => row.id === record.id && row.kind === record.kind,
          );
          if (record.kind === 'asset') {
            const comparable = structuredClone(current);
            comparable.data.asset.updatedAt = record.data.asset.updatedAt;
            assert.deepEqual(comparable, record);
            assert.equal(semanticHash(current), semanticHash(record));
          } else assert.deepEqual(current, record);
        }
      },
    );
  }
}
async function historyOverHttp(runtime, context, baseline, expectedCount = 3) {
  const history = await runtime.request(`/api/slots/${context.slotId}/history`);
  assert.equal(history.length, expectedCount);
  assert.deepEqual(
    history.map((row) => row.ordinal),
    Array.from({ length: expectedCount }, (_, index) => expectedCount - index),
  );
  for (const entry of history) {
    const version = baseline.tables.asset_versions.find(
      (row) => row.id === entry.pin.versionId,
    );
    const payload = JSON.parse(version.payload);
    assert.deepEqual(entry.source, {
      assetId: version.asset_id,
      versionId: version.id,
      name: payload.name,
      type: payload.type,
      versionOrdinal: version.ordinal,
    });
    const previous = context.history.find((row) => row.id === entry.id);
    if (previous) {
      assert.equal(Object.hasOwn(entry, 'actor'), false);
      const revision = structuredClone(entry);
      delete revision.source;
      assert.deepEqual(revision, previous);
    }
  }
  checks.push(
    'Real HTTP history preserves old entries without actor and enriches source from exact version, including A/V1 while A/V2 is current',
  );
  return history;
}
if (mode === 'seed') {
  await mkdir(join(base, 'working'), { recursive: false });
  const runtime = await start();
  let context, baseline;
  try {
    const library = await runtime.request('/api/libraries', {
      method: 'POST',
      body: { name: 'v0.3.1 槽位历史升级' },
    });
    const upload = (name, bytes) =>
      runtime.request(
        `/api/libraries/${library.id}/upload?name=${encodeURIComponent(name)}`,
        { method: 'POST', bytes },
      );
    const a = await upload(
      '角色A 原始V1.png',
      png([255, 30, 30], 'A original V1'),
    );
    const b = await upload(
      '角色B 原始V1.png',
      png([30, 30, 255], 'B original V1'),
    );
    const b2 = await runtime.request(
      `/api/assets/${b.id}/replace?name=${encodeURIComponent('角色B 手动V2.png')}`,
      { method: 'POST', bytes: png([10, 200, 150], 'B manual V2') },
    );
    const folder = await runtime.request(
      `/api/libraries/${library.id}/folders`,
      { method: 'POST', body: { name: '作者文件夹' } },
    );
    const tag = await runtime.request(`/api/libraries/${library.id}/tags`, {
      method: 'POST',
      body: { name: '作者标签', color: '#ff8a3d' },
    });
    for (const asset of [a, b])
      await runtime.request(`/api/assets/${asset.id}`, {
        method: 'PATCH',
        body: {
          displayName: `当前展示名 ${asset.id === a.id ? 'A' : 'B'}`,
          note: '必须原样保留的中文备注',
          rating: 5,
          folderId: folder.id,
          tagIds: [tag.id],
          prompt: '作者编辑提示词',
          negativePrompt: '模糊',
          model: 'authored-model',
          seed: '12345',
          source: 'SD WebUI',
          params: {
            authored: true,
            nested: { updatedAt: 'user-authored-value' },
          },
        },
      });
    await runtime.request(`/api/assets/${a.id}/annotations`, {
      method: 'POST',
      body: {
        versionId: a.currentVersionId,
        x: 0.25,
        y: 0.75,
        text: '固定 A/V1 的作者标注',
      },
    });
    let document = await runtime.request(
      `/api/libraries/${library.id}/boards`,
      { method: 'POST', body: { name: '旧版本槽位历史' } },
    );
    document = await runtime.request(`/api/boards/${document.board.id}/slots`, {
      method: 'POST',
      body: {
        expectedRevision: document.board.revision,
        label: '角色设定槽',
        x: 70,
        y: 90,
      },
    });
    const slotId = document.slots[0].id;
    const pinA1 = { assetId: a.id, versionId: a.currentVersionId },
      pinB2 = { assetId: b.id, versionId: b2.currentVersionId };
    for (const pin of [pinA1, pinB2, pinA1])
      document = await runtime.request(`/api/slots/${slotId}/assignment`, {
        method: 'PUT',
        body: { expectedRevision: document.slots[0].revision, pin },
      });
    const a2 = await runtime.request(
      `/api/assets/${a.id}/replace?name=${encodeURIComponent('角色A 后续手动V2.png')}`,
      { method: 'POST', bytes: png([180, 80, 230], 'A later manual V2') },
    );
    const history = await runtime.request(`/api/slots/${slotId}/history`);
    assert.equal(history.length, 3);
    assert.deepEqual(
      history.map((row) => row.pin),
      [pinA1, pinB2, pinA1],
    );
    assert.ok(
      history.every(
        (row) => !Object.hasOwn(row, 'actor') && !Object.hasOwn(row, 'source'),
      ),
    );
    assert.notEqual(a2.currentVersionId, pinA1.versionId);
    context = {
      paths,
      libraryId: library.id,
      boardId: document.board.id,
      slotId,
      aId: a.id,
      bId: b.id,
      pinA1,
      pinB2,
      pinA2: { assetId: a.id, versionId: a2.currentVersionId },
      history,
    };
    await runtime.app.close();
    baseline = await capture(runtime.database, library.id);
    assert.equal(baseline.tables.assets.length, 2);
    assert.equal(baseline.tables.asset_versions.length, 4);
    assert.equal(baseline.tables.slot_revisions.length, 3);
    assert.ok(
      baseline.tables.slot_revisions.every(
        (row) => !Object.hasOwn(row, 'actor_json'),
      ),
    );
  } finally {
    await runtime.close();
  }
  await cp(join(base, 'working'), join(base, 'frozen-v031'), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const frozenTree = await tree(join(base, 'frozen-v031'));
  await json('context.json', context);
  await json('baseline.json', baseline);
  await json('frozen-tree.json', frozenTree);
  await json('seed-evidence.json', {
    identity,
    counts: { assets: 2, versions: 4, revisions: 3 },
    sequence: ['A/V1', 'B/V2', 'A/V1'],
    currentAssets: ['A/V2', 'B/V2'],
    oldActorsAbsent: true,
    semanticHash: baseline.semanticHash,
    frozenTreeSha256: hash(JSON.stringify(frozenTree)),
    baselineSha256: hash(JSON.stringify(baseline)),
    boundary:
      'Actual released runtime and HTTP on Linux; no browser or physical Windows/macOS claim.',
  });
  console.log(
    JSON.stringify({
      seeded: true,
      base,
      identity,
      semanticHash: baseline.semanticHash,
    }),
  );
} else {
  const context = await readJson('context.json'),
    baseline = await readJson('baseline.json');
  const frozenTree = await readJson('frozen-tree.json');
  const runtime = await start();
  let afterMutation, historyAfter;
  try {
    // Force a finite real scan to settle the earlier Inbox migration before comparing graphs.
    await runtime.request(`/api/libraries/${context.libraryId}/rescan`, {
      method: 'POST',
    });
    const deadline = performance.now() + 15_000;
    while (true) {
      const scans = await runtime.request(
        `/api/libraries/${context.libraryId}/scans`,
      );
      if (scans.length && scans.every((row) => row.status === 'completed'))
        break;
      assert.ok(performance.now() < deadline, 'Upgrade scan did not settle');
      await new Promise((done) => setTimeout(done, 25));
    }
    const upgraded = await capture(runtime.database, context.libraryId);
    preserveLegacy(baseline, upgraded);
    await historyOverHttp(runtime, context, baseline);
    await versionsOverHttp(runtime, baseline);
    await json('upgraded-before-mutation.json', upgraded);
    const document = await runtime.request(`/api/boards/${context.boardId}`);
    const assigned = await runtime.request(
      `/api/slots/${context.slotId}/assignment`,
      {
        method: 'PUT',
        body: {
          expectedRevision: document.slots.find(
            (row) => row.id === context.slotId,
          ).revision,
          pin: context.pinB2,
        },
      },
    );
    check('New assignment increments the slot once and pins exact B/V2', () => {
      const slot = assigned.slots.find((row) => row.id === context.slotId);
      assert.equal(slot.revision, 4);
      assert.deepEqual(slot.currentPin, context.pinB2);
    });
    historyAfter = await historyOverHttp(runtime, context, baseline, 4);
    check('New real-HTTP assignment records explicit local actor', () =>
      assert.deepEqual(historyAfter[0].actor, { kind: 'local' }),
    );
    await runtime.app.close();
    afterMutation = await capture(runtime.database, context.libraryId);
    preserveLegacy(baseline, afterMutation, { newAssignment: true });
    check('Exactly one new SQL history row stores the local actor', () => {
      const created = afterMutation.tables.slot_revisions.filter(
        (row) =>
          !baseline.tables.slot_revisions.some((old) => old.id === row.id),
      );
      assert.equal(created.length, 1);
      assert.deepEqual(JSON.parse(created[0].actor_json), { kind: 'local' });
    });
    await json('upgraded-after-mutation.json', afterMutation);
  } finally {
    await runtime.close();
  }
  const reopened = await start();
  try {
    const history = await historyOverHttp(reopened, context, baseline, 4);
    check(
      'History including local actor survives closed-database restart exactly',
      () => assert.deepEqual(history, historyAfter),
    );
    await versionsOverHttp(reopened, baseline);
    await reopened.app.close();
    const snapshot = await capture(reopened.database, context.libraryId);
    preserveLegacy(baseline, snapshot, { newAssignment: true });
    check(
      'Reopen is idempotent for complete portable graph and slot SQL history',
      () => {
        assert.deepEqual(snapshot.records, afterMutation.records);
        assert.equal(snapshot.semanticHash, afterMutation.semanticHash);
        assert.deepEqual(
          snapshot.tables.slot_revisions,
          afterMutation.tables.slot_revisions,
        );
      },
    );
    await json('reopened.json', snapshot);
  } finally {
    await reopened.close();
  }
  const frozenAfter = await tree(join(base, 'frozen-v031'));
  check('Frozen released-runtime backup is unchanged', () =>
    assert.deepEqual(frozenAfter, frozenTree),
  );
  await json('upgrade-evidence.json', {
    released: (await readJson('seed-evidence.json')).identity,
    candidate: identity,
    counts: {
      assets: 2,
      versions: 4,
      oldSlotRevisions: 3,
      newSlotRevisions: 1,
    },
    migrationCounts: {
      released: baseline.tables.__drizzle_migrations.length,
      candidate: afterMutation.tables.__drizzle_migrations.length,
    },
    initialSemanticHash: baseline.semanticHash,
    afterAssignmentSemanticHash: afterMutation.semanticHash,
    passedChecks: checks.length,
    checks,
    fixture: base,
    boundary:
      'Actual old and candidate runtime using real HTTP and SQLite on Linux. No browser, physical Windows/macOS, or authenticated-account attribution claim.',
  });
  console.log(
    JSON.stringify({
      verified: true,
      base,
      candidate: expectedCommit,
      checks: checks.length,
    }),
  );
}
