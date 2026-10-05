import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

// Generated fixtures only. Run seed, then verify with the same acceptance directory.
// CURA_INBOX_ACCEPTANCE_DIR overrides the default <cwd>/.tmp/inbox-upgrade.
const BASE = resolve(
  process.env.CURA_INBOX_ACCEPTANCE_DIR ||
    join(process.cwd(), '.tmp', 'inbox-upgrade'),
);
const RELEASE = 'a078429110b64e99b4358e709de6657f84ccd9ab';
const [mode, sourceArgument, argument] = process.argv.slice(2);
assert.ok(
  ['seed', 'verify'].includes(mode),
  'Usage: seed <old-clone> | verify <candidate-clone> <expected-sha>',
);
const source = resolve(sourceArgument);
const git = (...args) =>
  execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const quote = (value) => `"${value.replaceAll('"', '""')}"`;
const sorted = (rows) =>
  rows.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const checks = [];
function check(label, action) {
  action();
  checks.push(label);
}
const sourceIdentity = {
  commit: git('rev-parse', 'HEAD'),
  runtimeTrees: Object.fromEntries(
    ['packages/server', 'packages/shared', 'pnpm-lock.yaml'].map((path) => [
      path,
      git('rev-parse', `HEAD:${path}`),
    ]),
  ),
  node: process.version,
  modules: process.versions.modules,
};
assert.equal(
  git('status', '--porcelain'),
  '',
  'Acceptance runtime must be built from a clean immutable source checkout',
);
assert.equal(sourceIdentity.commit, mode === 'seed' ? RELEASE : argument);
// Do not inherit optional cloud configuration into the offline generated-fixture run.
for (const key of Object.keys(process.env))
  if (/^(CURA_|SUPABASE_|VITE_SUPABASE_)/.test(key)) delete process.env[key];
const load = (file) =>
  import(pathToFileURL(join(source, 'packages/server/dist', file)).href);
const [{ openDatabase }, { createApp }, { readPortableGraph, semanticHash }] =
  await Promise.all([
    load('database.js'),
    load('app.js'),
    load('sync/portable.js'),
  ]);
const indexFile = join(BASE, '.tmp', 'fixture.json');

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
function png(color, name) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parameters = `${name}，中文提示词\nNegative prompt: 模糊\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 42, Size: 1x1, Model: fixture-v031`;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.from(`parameters\0${parameters}`, 'utf8')),
    chunk('IDAT', deflateSync(Buffer.from([0, ...color, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
async function start(paths) {
  const database = openDatabase(paths);
  const app = await createApp({ database, paths, staticRoot: false });
  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
  } catch (error) {
    await app.close();
    database.close();
    throw error;
  }
  const address = app.server.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const request = async (path, { method = 'GET', body, bytes } = {}) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        origin,
        ...(body === undefined && bytes === undefined
          ? {}
          : {
              'content-type': bytes
                ? 'application/octet-stream'
                : 'application/json',
            }),
      },
      body: bytes ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json();
    assert.ok(
      response.ok,
      `${method} ${path} returned ${response.status}: ${JSON.stringify(result)}`,
    );
    return result;
  };
  return {
    database,
    app,
    request,
    close: async () => {
      await app.close();
      database.close();
    },
  };
}
async function settle(runtime, libraryId) {
  const roots = await runtime.request(`/api/libraries/${libraryId}/roots`);
  await runtime.request(`/api/libraries/${libraryId}/rescan`, {
    method: 'POST',
  });
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    const summaries = await runtime.request(
      `/api/libraries/${libraryId}/scans`,
    );
    if (
      summaries.length === roots.length &&
      summaries.every((summary) => summary.status !== 'running')
    ) {
      assert.ok(
        summaries.every((summary) => summary.status === 'completed'),
        JSON.stringify(summaries),
      );
      return summaries;
    }
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error('Generated fixture scans did not settle');
}
async function waitForRelocations(runtime, context, baseline) {
  const originals = baseline.tables.asset_sources.filter(
    (row) => row.root_id === context.inboxRootId && row.available,
  );
  const root = baseline.tables.library_roots.find(
    (row) => row.id === context.inboxRootId,
  );
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    const current = runtime.database.sqlite
      .prepare('SELECT * FROM asset_sources WHERE root_id=? AND available=1')
      .all(context.inboxRootId);
    if (
      current.length === originals.length &&
      current.every((row) => /^\d{4}-\d{2}-\d{2}\//u.test(row.relative_path))
    ) {
      const cleaned = await Promise.all(
        originals.map(async (row) => {
          try {
            await stat(join(root.path, row.actual_relative_path));
            return false;
          } catch (error) {
            if (error.code === 'ENOENT') return true;
            throw error;
          }
        }),
      );
      if (cleaned.every(Boolean)) return;
    }
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(
    'Seven generated legacy sources did not complete relocation and cleanup within 15 seconds',
  );
}
async function capture(database, libraryId) {
  const tableNames = database.sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map(({ name }) => name);
  const tables = Object.fromEntries(
    tableNames.map((name) => [
      name,
      sorted(database.sqlite.prepare(`SELECT * FROM ${quote(name)}`).all()),
    ]),
  );
  const versions = tables.asset_versions;
  const files = [];
  for (const version of versions) {
    const bytes = await readFile(version.snapshot_path);
    assert.equal(sha256(bytes), JSON.parse(version.payload).hash);
    files.push({
      kind: 'snapshot',
      id: version.id,
      hash: sha256(bytes),
      size: bytes.length,
    });
    if (version.thumbnail_path) {
      const thumbnail = await readFile(version.thumbnail_path);
      files.push({
        kind: 'thumbnail',
        id: version.id,
        hash: sha256(thumbnail),
        size: thumbnail.length,
      });
    }
  }
  for (const entry of tables.asset_sources) {
    const root = tables.library_roots.find((item) => item.id === entry.root_id);
    try {
      const bytes = await readFile(join(root.path, entry.actual_relative_path));
      assert.equal(
        sha256(bytes),
        entry.last_hash,
        'Source hash must stay independent from the manual current version',
      );
      files.push({
        kind: 'source',
        id: entry.id,
        hash: sha256(bytes),
        size: bytes.length,
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      assert.equal(entry.available, 0);
      files.push({ kind: 'source', id: entry.id, missing: true });
    }
  }
  const records = readPortableGraph(database, libraryId).records;
  return {
    tables,
    files: sorted(files),
    records,
    semanticHash: semanticHash(records),
    integrity: database.sqlite.pragma('integrity_check'),
    foreignKeys: database.sqlite.pragma('foreign_key_check'),
  };
}
function integrity(value) {
  assert.deepEqual(value.integrity, [{ integrity_check: 'ok' }]);
  assert.deepEqual(value.foreignKeys, []);
}
function without(row, omitted) {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !omitted.includes(key)),
  );
}
function stableAssets(rows) {
  return rows
    .map((row) => ({
      ...without(row, ['relative_path', 'payload', 'search_text']),
      payload: without(JSON.parse(row.payload), ['relativePath']),
    }))
    .toSorted((a, b) => a.id.localeCompare(b.id));
}
function stableSources(rows) {
  return rows
    .map((row) =>
      without(row, ['relative_path', 'actual_relative_path', 'updated_at']),
    )
    .toSorted((a, b) => a.id.localeCompare(b.id));
}
function compare(before, after) {
  check(
    'Every immutable asset_versions SQL row, including payload, hashes, ordinals, snapshot paths and timestamps, is identical',
    () =>
      assert.deepEqual(
        after.tables.asset_versions,
        before.tables.asset_versions,
      ),
  );
  check(
    'All retained snapshot bytes, thumbnail bytes and existing source bytes remain identical; missing source remains missing',
    () => assert.deepEqual(after.files, before.files),
  );
  check(
    'Asset metadata, logical names, manual V2 selection, hashes and timestamps are unchanged',
    () =>
      assert.deepEqual(
        stableAssets(after.tables.assets),
        stableAssets(before.tables.assets),
      ),
  );
  check(
    'Source IDs, root/asset IDs, last_hash, availability and creation times are unchanged',
    () =>
      assert.deepEqual(
        stableSources(after.tables.asset_sources),
        stableSources(before.tables.asset_sources),
      ),
  );
  const replaceLocators = (text, assetId) => {
    for (const old of before.tables.asset_sources.filter(
      (row) => row.asset_id === assetId,
    )) {
      const current = after.tables.asset_sources.find(
        (row) => row.id === old.id,
      );
      text = text.replaceAll(
        old.relative_path.normalize('NFC').toLowerCase(),
        current.relative_path.normalize('NFC').toLowerCase(),
      );
    }
    return text;
  };
  check(
    'Derived search_text changes are exactly the source-locator substitutions and nothing else',
    () => {
      for (const old of before.tables.assets) {
        const current = after.tables.assets.find((row) => row.id === old.id);
        assert.equal(
          current.search_text,
          replaceLocators(old.search_text, old.id),
        );
      }
    },
  );
  check(
    'FTS logical records match the same precise locator-only substitutions',
    () => {
      const expected = sorted(
        before.tables.asset_fts.map((row) => ({
          ...row,
          text: replaceLocators(row.text, row.asset_id),
        })),
      );
      assert.deepEqual(after.tables.asset_fts, expected);
    },
  );
  for (const [name, rows] of Object.entries(before.tables)) {
    if (
      [
        'assets',
        'asset_sources',
        'root_scan_summaries',
        '__drizzle_migrations',
        'asset_fts',
      ].includes(name) ||
      name.startsWith('asset_fts_')
    )
      continue;
    check(`Legacy table ${name} unchanged`, () =>
      assert.deepEqual(after.tables[name], rows),
    );
  }
  check(
    'Portable graph records remain byte-for-byte logically identical and semantic hashes match',
    () => {
      assert.deepEqual(after.records, before.records);
      assert.equal(after.semanticHash, before.semanticHash);
    },
  );
  check('SQLite integrity_check and foreign_key_check pass', () =>
    integrity(after),
  );
}

async function verifySearch(runtime, context, baseline) {
  const current = runtime.database.sqlite
    .prepare('SELECT * FROM asset_sources')
    .all();
  for (const old of baseline.tables.asset_sources) {
    const asset = baseline.tables.assets.find((row) => row.id === old.asset_id);
    const entry = current.find((row) => row.id === old.id);
    const query = async (value) =>
      runtime.request(
        `/api/libraries/${context.libraryId}/assets?${new URLSearchParams({ q: value, trash: String(asset.deleted_at !== null) })}`,
      );
    const previousResult = await query(old.relative_path);
    if (old.relative_path !== entry.relative_path) {
      assert.equal(
        previousResult.total,
        0,
        'Moved legacy UUID locator must stop matching in live catalog search',
      );
      const currentResult = await query(entry.relative_path);
      assert.ok(
        currentResult.items.some((row) => row.id === old.asset_id),
        'New dated locator must find its original asset, including aliases and Trash',
      );
    } else
      assert.ok(
        previousResult.items.some((row) => row.id === old.asset_id),
        'Reference and missing source locators remain searchable',
      );
  }
  checks.push(
    'Real HTTP catalog search finds every dated alias and Trash source, rejects moved UUID locators, and retains missing/reference locator search',
  );
}

if (mode === 'seed') {
  await mkdir(join(BASE, '.tmp'), { recursive: true });
  const fixture = await mkdtemp(join(BASE, '.tmp', 'legacy-inbox-'));
  const paths = Object.fromEntries(
    ['data', 'cache', 'log'].map((name) => [name, join(fixture, name)]),
  );
  const referencePath = join(fixture, '原始参考');
  await mkdir(join(referencePath, '资料'), { recursive: true });
  await writeFile(
    join(referencePath, '资料', '参考图.png'),
    png([17, 55, 99], '参考控制'),
  );
  const runtime = await start(paths);
  let context, baseline;
  try {
    const { request, database } = runtime;
    const library = await request('/api/libraries', {
      method: 'POST',
      body: { name: 'v0.3.1 收件箱真实升级' },
    });
    const upload = (name, bytes) =>
      request(
        `/api/libraries/${library.id}/upload?name=${encodeURIComponent(name)}`,
        { method: 'POST', bytes },
      );
    const aBytes = png([255, 0, 0], '角色原始 V1');
    const a = await upload('角色 e\u0301 中文.png', aBytes);
    const aAlias = await upload('角色原始别名.png', aBytes);
    assert.equal(aAlias.id, a.id);
    const b = await upload('角色 é 中文.png', png([0, 0, 255], '另一角色'));
    const cBytes = png([255, 127, 0], '同名原件');
    const c = await upload('同名.png', cBytes);
    const d = await upload('同名.png', png([127, 0, 255], '同名不同内容'));
    const cAlias = await upload('别名副本.png', cBytes);
    assert.equal(cAlias.id, c.id);
    const trash = await upload('待回收.png', png([255, 255, 0], '回收站保留'));
    const missing = await upload('已移走.png', png([21, 38, 47], '原件离线'));
    const referenceRoot = await request(`/api/libraries/${library.id}/roots`, {
      method: 'POST',
      body: { path: referencePath },
    });
    // HTTP validates to NFC, while a macOS-style physical NFD rename must still
    // resolve the existing canonical source during the released runtime scan.
    const physicalSource = database.sqlite
      .prepare(
        'SELECT s.*,r.path AS root_path FROM asset_sources s JOIN library_roots r ON r.id=s.root_id WHERE asset_id=? AND s.relative_path LIKE ?',
      )
      .get(a.id, '%/角色 é 中文.png');
    const physicalNfc = join(
      physicalSource.root_path,
      physicalSource.actual_relative_path,
    );
    await rename(
      physicalNfc,
      join(dirname(physicalNfc), basename(physicalNfc).normalize('NFD')),
    );
    await settle(runtime, library.id);
    const aV2 = await request(
      `/api/assets/${a.id}/replace?name=${encodeURIComponent('角色 定稿V2.png')}`,
      { method: 'POST', bytes: png([0, 255, 0], '手动定稿 V2') },
    );
    const folder = await request(`/api/libraries/${library.id}/folders`, {
      method: 'POST',
      body: { name: '客户 · 角色设定' },
    });
    const tag = await request(`/api/libraries/${library.id}/tags`, {
      method: 'POST',
      body: { name: '保留标签', color: '#ff8a3d' },
    });
    await request(`/api/assets/${a.id}`, {
      method: 'PATCH',
      body: {
        rating: 5,
        note: '保留人工备注与手动定稿',
        displayName: '角色展示名',
        folderId: folder.id,
        tagIds: [tag.id],
        prompt: '人工中文提示词',
        negativePrompt: '模糊与噪点',
        model: 'manual-fixture-model',
        seed: '123456',
        source: 'SD WebUI',
        params: { fixture: true, nested: { updatedAt: 'authored-value' } },
      },
    });
    await request(`/api/assets/${a.id}/annotations`, {
      method: 'POST',
      body: {
        versionId: a.currentVersionId,
        x: 0.25,
        y: 0.75,
        text: '固定在原始 V1 的中文标注',
      },
    });
    await request(`/api/libraries/${library.id}/assets/batch`, {
      method: 'POST',
      body: { assetIds: [trash.id], action: 'trash' },
    });
    const missingSource = database.sqlite
      .prepare(
        'SELECT s.*,r.path AS root_path FROM asset_sources s JOIN library_roots r ON r.id=s.root_id WHERE asset_id=?',
      )
      .get(missing.id);
    await unlink(
      join(missingSource.root_path, missingSource.actual_relative_path),
    );
    await settle(runtime, library.id);
    await runtime.app.close();
    baseline = await capture(database, library.id);
    integrity(baseline);
    assert.equal(baseline.tables.assets.length, 7);
    assert.equal(baseline.tables.asset_versions.length, 8);
    assert.equal(baseline.tables.asset_sources.length, 9);
    assert.equal(
      baseline.tables.asset_sources.filter(
        (row) =>
          row.actual_relative_path !==
          row.actual_relative_path.normalize('NFC'),
      ).length,
      1,
    );
    const aRow = baseline.tables.assets.find((row) => row.id === a.id);
    assert.equal(JSON.parse(aRow.payload).name, '角色 定稿V2.png');
    assert.equal(
      JSON.parse(aRow.payload).currentVersionId,
      aV2.currentVersionId,
    );
    assert.equal(
      baseline.tables.asset_sources.filter(
        (row) => row.asset_id === a.id && row.last_hash === sha256(aBytes),
      ).length,
      2,
    );
    assert.notEqual(aRow.current_hash, sha256(aBytes));
    assert.equal(baseline.files.filter((file) => file.missing).length, 1);
    const inboxRoot = baseline.tables.library_roots.find(
      (row) => row.kind === 'inbox',
    );
    const inboxSources = baseline.tables.asset_sources.filter(
      (row) => row.root_id === inboxRoot.id,
    );
    assert.ok(
      inboxSources.every((row) =>
        /^[a-f0-9-]{36}\/.+\.png$/u.test(row.relative_path),
      ),
    );
    context = {
      fixture,
      paths,
      libraryId: library.id,
      aId: a.id,
      aV1Id: a.currentVersionId,
      aV2Id: aV2.currentVersionId,
      bId: b.id,
      cId: c.id,
      dId: d.id,
      trashId: trash.id,
      missingId: missing.id,
      inboxRootId: inboxRoot.id,
      referenceRootId: referenceRoot.id,
      sourceIdentity,
    };
    await writeFile(
      join(fixture, 'baseline.json'),
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
    await writeFile(indexFile, `${JSON.stringify(context, null, 2)}\n`);
  } finally {
    await runtime.app.close();
    runtime.database.close();
  }
  await cp(join(fixture, 'data'), join(fixture, 'closed-v031-backup'), {
    recursive: true,
  });
  const result = {
    status: 'seeded',
    source: sourceIdentity,
    generatedFixtureOnly: true,
    counts: {
      assets: 7,
      versions: 8,
      sources: 9,
      inboxSources: 8,
      existingInboxSources: 7,
      missingInboxSources: 1,
      referenceSources: 1,
      dedupAliasSources: 2,
    },
    features: [
      'Chinese and NFD upload request names plus one real physical NFD rename observed by the released runtime',
      'Two equal-name distinct-content pairs',
      'V1 alias retained beside manually replaced differently named V2',
      'Second dedup alias pair',
      'Trashed Inbox asset',
      'Missing original with retained snapshot',
      'External reference control',
      'Chinese metadata, tags, folder, annotation',
    ],
    portableRecords: baseline.records.length,
    portableSemanticHash: baseline.semanticHash,
    databaseSha256: sha256(
      await readFile(join(context.paths.data, 'cura.sqlite')),
    ),
    oldRelease: 'v0.3.1',
    upgradeRun: false,
  };
  await writeFile(
    join(BASE, 'seed-evidence.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(JSON.stringify(result, null, 2));
} else {
  const context = JSON.parse(await readFile(indexFile, 'utf8'));
  const baseline = JSON.parse(
    await readFile(join(context.fixture, 'baseline.json'), 'utf8'),
  );
  const passes = [];
  let previous;
  for (let pass = 1; pass <= 2; pass++) {
    const runtime = await start(context.paths);
    let snapshot;
    try {
      await waitForRelocations(runtime, context, baseline);
      await settle(runtime, context.libraryId);
      await verifySearch(runtime, context, baseline);
      await runtime.app.close();
      snapshot = await capture(runtime.database, context.libraryId);
      compare(baseline, snapshot);
      const oldSources = baseline.tables.asset_sources;
      let moved = 0,
        suffixes = 0;
      for (const entry of snapshot.tables.asset_sources) {
        const old = oldSources.find((row) => row.id === entry.id);
        if (entry.root_id === context.referenceRootId || !entry.available) {
          check(
            'External reference and missing legacy source locators stay unchanged',
            () => {
              assert.equal(entry.relative_path, old.relative_path);
              assert.equal(
                entry.actual_relative_path,
                old.actual_relative_path,
              );
            },
          );
          if (!entry.available)
            check(
              'Missing source row remains exactly unchanged, including unavailable state and timestamps',
              () => assert.deepEqual(entry, old),
            );
          continue;
        }
        assert.equal(entry.root_id, context.inboxRootId);
        assert.match(entry.relative_path, /^\d{4}-\d{2}-\d{2}\/[^/]+\.png$/u);
        assert.equal(entry.relative_path, entry.relative_path.normalize('NFC'));
        assert.equal(entry.actual_relative_path, entry.relative_path);
        const created = new Date(old.created_at);
        const date = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')}`;
        assert.ok(entry.relative_path.startsWith(`${date}/`));
        if (basename(entry.relative_path) !== basename(old.relative_path)) {
          const oldName = basename(old.relative_path, '.png');
          assert.match(
            basename(entry.relative_path),
            new RegExp(
              `^${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ -][a-f0-9]{8}\\.png$`,
              'u',
            ),
          );
          suffixes++;
        }
        const root = snapshot.tables.library_roots.find(
          (row) => row.id === entry.root_id,
        );
        await assert.rejects(stat(join(root.path, old.actual_relative_path)), {
          code: 'ENOENT',
        });
        await assert.rejects(
          stat(dirname(join(root.path, old.actual_relative_path))),
          {
            code: 'ENOENT',
          },
        );
        moved++;
      }
      assert.equal(moved, 7);
      assert.equal(suffixes, 2);
      check(
        'Each asset locator follows only its original primary source; aliases never replace primary identity',
        () => {
          for (const row of snapshot.tables.assets) {
            const old = baseline.tables.assets.find(
              (entry) => entry.id === row.id,
            );
            const primary = oldSources.find(
              (entry) =>
                entry.root_id === old.root_id &&
                entry.relative_path === old.relative_path,
            );
            const nextPrimary =
              primary &&
              snapshot.tables.asset_sources.find(
                (entry) => entry.id === primary.id,
              );
            const expected = nextPrimary?.relative_path ?? old.relative_path;
            assert.equal(row.relative_path, expected);
            assert.equal(JSON.parse(row.payload).relativePath, expected);
          }
        },
      );
      const trashSources = snapshot.tables.asset_sources.filter(
        (row) => row.asset_id === context.trashId,
      );
      assert.equal(trashSources.length, 1);
      assert.match(trashSources[0].relative_path, /^\d{4}-\d{2}-\d{2}\//u);
      if (previous) {
        check(
          'Second startup retains the identical Inbox path mapping, immutable rows and portable graph',
          () => {
            assert.deepEqual(
              snapshot.tables.asset_sources.map((row) =>
                without(row, ['updated_at']),
              ),
              previous.tables.asset_sources.map((row) =>
                without(row, ['updated_at']),
              ),
            );
            assert.deepEqual(snapshot.tables.assets, previous.tables.assets);
            assert.deepEqual(
              snapshot.tables.asset_versions,
              previous.tables.asset_versions,
            );
            assert.deepEqual(snapshot.records, previous.records);
            assert.deepEqual(
              snapshot.tables.inbox_migrations,
              previous.tables.inbox_migrations,
            );
          },
        );
      }
      const newTables = Object.keys(snapshot.tables).filter(
        (name) => !(name in baseline.tables),
      );
      check(
        'Only migration 0010 and its local Inbox journal were added; seven real relocations completed',
        () => {
          assert.deepEqual(newTables, ['inbox_migrations']);
          assert.equal(
            snapshot.tables.__drizzle_migrations.length,
            baseline.tables.__drizzle_migrations.length + 1,
          );
          for (const row of baseline.tables.__drizzle_migrations)
            assert.deepEqual(
              snapshot.tables.__drizzle_migrations.find(
                (entry) => entry.hash === row.hash,
              ),
              row,
            );
          assert.equal(snapshot.tables.inbox_migrations.length, 7);
          assert.ok(
            snapshot.tables.inbox_migrations.every(
              (row) => row.state === 'complete',
            ),
          );
          assert.deepEqual(
            snapshot.tables.inbox_migrations.map((row) => row.source_id).sort(),
            baseline.tables.asset_sources
              .filter(
                (row) => row.root_id === context.inboxRootId && row.available,
              )
              .map((row) => row.id)
              .sort(),
          );
        },
      );
      passes.push({
        pass,
        sourcesInDatedLayout: moved,
        collisionSuffixes: suffixes,
        newTables,
        completedJournalRows: snapshot.tables.inbox_migrations.length,
        migrations: snapshot.tables.__drizzle_migrations.length,
        integrity: 'ok',
        foreignKeyViolations: 0,
      });
      previous = snapshot;
      await writeFile(
        join(context.fixture, `candidate-pass-${pass}.json`),
        `${JSON.stringify(snapshot, null, 2)}\n`,
      );
    } finally {
      await runtime.app.close();
      runtime.database.close();
    }
  }
  const result = {
    status: 'passed',
    oldRelease: 'v0.3.1',
    oldSource: context.sourceIdentity,
    candidate: sourceIdentity,
    counts: {
      assets: baseline.tables.assets.length,
      versions: baseline.tables.asset_versions.length,
      sources: baseline.tables.asset_sources.length,
    },
    passes,
    portableSemanticHash: baseline.semanticHash,
    checks: [...new Set(checks)],
    sources: baseline.tables.asset_sources.map((old) => {
      const current = previous.tables.asset_sources.find(
        (row) => row.id === old.id,
      );
      return {
        sourceId: old.id,
        assetId: old.asset_id,
        kind: old.root_id === context.inboxRootId ? 'inbox' : 'reference',
        available: Boolean(old.available),
        lastHash: old.last_hash,
        beforeRelativePath: old.relative_path,
        beforeActualRelativePath: old.actual_relative_path,
        afterRelativePath: current.relative_path,
        afterActualRelativePath: current.actual_relative_path,
      };
    }),
    operationalExceptions: [
      'Derived search_text and FTS change only by verified source-locator substitutions; real HTTP old/new path searches checked',
      'Automatic scan summaries change on startup/rescan',
      'Normal source observation can update asset_sources.updated_at',
      'Expected SQL migration registration and local Inbox relocation journal',
    ],
    boundaries: [
      'Generated fixture on Linux; no macOS/Windows filesystem or file-lock claim',
      'Missing original remains missing; retained snapshot bytes verified',
      'Browser/performance not exercised by this upgrade harness',
    ],
  };
  await writeFile(
    join(BASE, 'upgrade-evidence.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(JSON.stringify(result, null, 2));
}
