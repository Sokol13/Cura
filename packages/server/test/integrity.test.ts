import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { runDatabaseIntegrity } from '../src/diagnostics/integrity.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'cura-integrity-private-'));
  directories.push(directory);
  const databasePath = join(directory, 'private-catalog.sqlite');
  const database = new Database(databasePath);
  database.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE private_parent (id TEXT PRIMARY KEY);
    CREATE TABLE private_child (
      id INTEGER PRIMARY KEY,
      parent_id TEXT REFERENCES private_parent(id),
      quantity INTEGER CHECK(quantity > 0)
    );
    INSERT INTO private_parent VALUES ('secret-parent');
    INSERT INTO private_child VALUES (1, 'secret-parent', 1);
    PRAGMA user_version = 17;
    PRAGMA application_id = 42;
  `);
  return { directory, databasePath, database };
}

function damageIndex(
  databasePath: string,
  database: Database.Database,
  rows: number,
) {
  database.exec('CREATE INDEX private_index ON private_child(quantity)');
  const index = database
    .prepare(
      "SELECT type, name, tbl_name, rootpage, sql FROM sqlite_schema WHERE name = 'private_index'",
    )
    .get();
  database.unsafeMode(true);
  database.exec(
    "PRAGMA writable_schema = ON; DELETE FROM sqlite_schema WHERE name = 'private_index';",
  );
  database.close();
  const corrupt = new Database(databasePath);
  try {
    corrupt.pragma('foreign_keys = OFF');
    const insert = corrupt.prepare(
      'INSERT INTO private_child VALUES (?, ?, 1)',
    );
    corrupt.transaction(() => {
      for (let index = 0; index < rows; index++)
        insert.run(index + 2, 'secret-missing-parent');
    })();
    // Restore the old index definition without its new rows, creating a real
    // index inconsistency that integrity_check also detects in read-only mode.
    corrupt.unsafeMode(true);
    corrupt.pragma('writable_schema = ON');
    corrupt
      .prepare(
        'INSERT INTO sqlite_schema(type, name, tbl_name, rootpage, sql) VALUES (@type, @name, @tbl_name, @rootpage, @sql)',
      )
      .run(index);
  } finally {
    corrupt.close();
  }
}

it('checks a healthy database without changing bytes, schema, pragmas or files', async () => {
  const { directory, databasePath, database } = await fixture();
  const schema = database.prepare('SELECT * FROM sqlite_schema').all();
  database.close();
  const before = await readFile(databasePath);
  const files = await readdir(directory);
  const result = await runDatabaseIntegrity(databasePath);
  expect(result).toEqual({
    status: 'ok',
    checkedAt: expect.any(String),
    durationMs: expect.any(Number),
    integrityCheck: 'ok',
    foreignKeyCheck: 'ok',
    issues: [],
    truncated: false,
  });
  expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false);
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
  expect(Number.isInteger(result.durationMs)).toBe(true);
  expect(await readFile(databasePath)).toEqual(before);
  expect(await readdir(directory)).toEqual(files);
  const reopened = new Database(databasePath, { readonly: true });
  try {
    expect(reopened.prepare('SELECT * FROM sqlite_schema').all()).toEqual(
      schema,
    );
    expect(reopened.pragma('user_version', { simple: true })).toBe(17);
    expect(reopened.pragma('application_id', { simple: true })).toBe(42);
  } finally {
    reopened.close();
  }
});

it('reports foreign-key violations without exporting table names, values or paths', async () => {
  const { directory, databasePath, database } = await fixture();
  database.exec(
    "INSERT INTO private_child VALUES (2, 'secret-missing-parent', 1)",
  );
  database.close();
  const result = await runDatabaseIntegrity(databasePath);
  expect(result).toMatchObject({
    status: 'issues',
    integrityCheck: 'ok',
    foreignKeyCheck: 'issues',
    issues: [{ code: 'FOREIGN_KEY_VIOLATION' }],
    truncated: false,
  });
  const exported = JSON.stringify(result);
  for (const secret of [
    directory,
    'private_parent',
    'private_child',
    'secret-missing-parent',
  ]) {
    expect(exported).not.toContain(secret);
  }
});

it('runs both checks and replaces SQLite integrity messages with safe issue codes', async () => {
  const { databasePath, database } = await fixture();
  damageIndex(databasePath, database, 1);
  const result = await runDatabaseIntegrity(databasePath);
  expect(result).toMatchObject({
    status: 'issues',
    integrityCheck: 'issues',
    foreignKeyCheck: 'issues',
    issues: [
      { code: 'INTEGRITY_VIOLATION' },
      { code: 'INTEGRITY_VIOLATION' },
      { code: 'FOREIGN_KEY_VIOLATION' },
    ],
    truncated: false,
  });
  expect(JSON.stringify(result)).not.toMatch(
    /private_|secret-|constraint failed/i,
  );
});

it('reads committed WAL contents while the application connection stays open', async () => {
  const { databasePath, database } = await fixture();
  database.pragma('journal_mode = WAL');
  database.exec("INSERT INTO private_child VALUES (2, 'secret-wal-parent', 1)");
  try {
    expect(await runDatabaseIntegrity(databasePath)).toMatchObject({
      status: 'issues',
      integrityCheck: 'ok',
      foreignKeyCheck: 'issues',
      issues: [{ code: 'FOREIGN_KEY_VIOLATION' }],
    });
  } finally {
    database.close();
  }
});

it.each([20, 27])(
  'caps %i foreign-key violations at 20 and detects overflow',
  async (count) => {
    const { databasePath, database } = await fixture();
    const insert = database.prepare(
      'INSERT INTO private_child VALUES (?, ?, 1)',
    );
    database.transaction(() => {
      for (let index = 0; index < count; index++)
        insert.run(index + 2, 'secret-missing-parent');
    })();
    database.close();
    const result = await runDatabaseIntegrity(databasePath);
    expect(result.status).toBe('issues');
    expect(result.issues.map((issue) => issue.code)).toEqual(
      Array.from({ length: 20 }, () => 'FOREIGN_KEY_VIOLATION'),
    );
    expect(result.truncated).toBe(count > 20);
  },
);

it('bounds the combined issue list when both checks reach the cap', async () => {
  const { databasePath, database } = await fixture();
  damageIndex(databasePath, database, 25);
  const result = await runDatabaseIntegrity(databasePath);
  expect(result).toMatchObject({
    status: 'issues',
    integrityCheck: 'issues',
    foreignKeyCheck: 'issues',
    truncated: true,
  });
  expect(result.issues).toHaveLength(20);
  expect(JSON.stringify(result).length).toBeLessThan(1200);
});

it('includes safe locations for known application foreign-key tables', async () => {
  const { databasePath, database } = await fixture();
  database.exec(`
    CREATE TABLE libraries (id TEXT PRIMARY KEY);
    CREATE TABLE assets (id TEXT PRIMARY KEY, library_id TEXT REFERENCES libraries(id));
    INSERT INTO assets VALUES ('secret-user-asset-id', 'secret-library-id');
  `);
  database.close();
  const result = await runDatabaseIntegrity(databasePath);
  expect(result.issues).toEqual([
    {
      code: 'FOREIGN_KEY_VIOLATION',
      table: 'assets',
      parent: 'libraries',
      rowid: 1,
      foreignKeyId: 0,
    },
  ]);
  expect(JSON.stringify(result)).not.toContain('secret-');
});

it('keeps the independent integrity result when foreign-key checking throws', async () => {
  const { databasePath, database } = await fixture();
  database.exec(`
    CREATE TABLE libraries (id TEXT);
    CREATE TABLE assets (id TEXT PRIMARY KEY, library_id TEXT REFERENCES libraries(id));
  `);
  database.close();
  const result = await runDatabaseIntegrity(databasePath);
  expect(result).toMatchObject({
    status: 'error',
    integrityCheck: 'ok',
    foreignKeyCheck: 'error',
    issues: [{ code: 'CHECK_FAILED' }],
    code: 'SQLITE_CHECK_FAILED',
  });
  expect(JSON.stringify(result)).not.toMatch(/mismatch|libraries|assets/);
});

it('keeps null rowids and omits unsafe numeric rowids without exporting user keys', async () => {
  const { databasePath, database } = await fixture();
  database.exec(`
    CREATE TABLE libraries (id TEXT PRIMARY KEY);
    CREATE TABLE assets (id TEXT PRIMARY KEY, library_id TEXT REFERENCES libraries(id)) WITHOUT ROWID;
    INSERT INTO assets VALUES ('secret-user-asset-id', 'secret-library-id');
    INSERT INTO private_child VALUES (9223372036854775807, 'secret-missing-parent', 1);
  `);
  database.close();
  const result = await runDatabaseIntegrity(databasePath);
  expect(result.issues).toEqual(
    expect.arrayContaining([
      {
        code: 'FOREIGN_KEY_VIOLATION',
        table: 'assets',
        parent: 'libraries',
        rowid: null,
        foreignKeyId: 0,
      },
      { code: 'FOREIGN_KEY_VIOLATION', foreignKeyId: 0 },
    ]),
  );
  expect(JSON.stringify(result)).not.toMatch(/secret-|private_child/);
});

it('reports corrupt bytes safely and leaves the file unchanged', async () => {
  const { directory, databasePath, database } = await fixture();
  database.close();
  const bytes = Buffer.from('private corrupt catalog contents and credentials');
  await writeFile(databasePath, bytes);
  const result = await runDatabaseIntegrity(databasePath);
  expect(result.status).toBe('error');
  expect(['SQLITE_OPEN_FAILED', 'SQLITE_CHECK_FAILED']).toContain(result.code);
  expect(result.integrityCheck).not.toBe('ok');
  expect(result.foreignKeyCheck).not.toBe('ok');
  expect(JSON.stringify(result)).not.toMatch(
    /private|credentials|not a database/i,
  );
  expect(JSON.stringify(result)).not.toContain(directory);
  expect(await readFile(databasePath)).toEqual(bytes);
});

it('does not create a missing database or run migrations', async () => {
  const { directory, database } = await fixture();
  database.close();
  const files = await readdir(directory);
  const result = await runDatabaseIntegrity(join(directory, 'missing.sqlite'));
  expect(result).toMatchObject({
    status: 'error',
    integrityCheck: 'not-run',
    foreignKeyCheck: 'not-run',
    code: 'SQLITE_OPEN_FAILED',
    issues: [],
    truncated: false,
  });
  expect(await readdir(directory)).toEqual(files);
});

it('shares an in-flight check, enforces the deadline and permits a fresh check afterward', async () => {
  const { directory, databasePath, database } = await fixture();
  database.close();
  const workerFile = join(directory, 'blocked-worker.cjs');
  await writeFile(
    workerFile,
    'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);',
  );
  const started = performance.now();
  const first = runDatabaseIntegrity(databasePath, {
    workerFile: pathToFileURL(workerFile),
    timeoutMs: 80,
  });
  const concurrent = runDatabaseIntegrity(
    join(directory, '.', 'private-catalog.sqlite'),
  );
  expect(concurrent).toBe(first);
  expect(await first).toMatchObject({
    status: 'timeout',
    integrityCheck: 'not-run',
    foreignKeyCheck: 'not-run',
    code: 'INTEGRITY_TIMEOUT',
    issues: [],
  });
  expect(performance.now() - started).toBeLessThan(1000);
  await expect
    .poll(async () => (await runDatabaseIntegrity(databasePath)).status)
    .toBe('ok');
});

it.each([
  ['exception', "throw new Error('private-secret-worker-path');"],
  ['early exit', 'process.exit(0);'],
  [
    'invalid response',
    "require('node:worker_threads').parentPort.postMessage({error: 'private-secret-worker-path'});",
  ],
  [
    'oversized response',
    `require('node:worker_threads').parentPort.postMessage({
    status: 'issues', checkedAt: new Date().toISOString(), durationMs: 0,
    integrityCheck: 'issues', foreignKeyCheck: 'ok', truncated: true,
    issues: Array.from({length: 21}, () => ({code: 'INTEGRITY_VIOLATION'}))
  });`,
  ],
])(
  'reports worker %s safely without caching the failure',
  async (_name, script) => {
    const { directory, databasePath, database } = await fixture();
    database.close();
    const workerFile = join(directory, 'broken-worker.cjs');
    await writeFile(workerFile, script!);
    const result = await runDatabaseIntegrity(databasePath, {
      workerFile: pathToFileURL(workerFile),
    });
    expect(result).toMatchObject({
      status: 'error',
      code: 'INTEGRITY_WORKER_FAILED',
    });
    expect(JSON.stringify(result)).not.toMatch(/private|secret/);
    await expect
      .poll(async () => (await runDatabaseIntegrity(databasePath)).status)
      .toBe('ok');
  },
);
