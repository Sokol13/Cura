import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, expect, it } from 'vitest';
import { DiagnosticLogsSnapshotSchema } from '@cura/shared';
import { WarningJournal } from '../src/diagnostics/journal.js';
import { withDiagnosticJournal } from '../src/diagnostics/logger.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'cura-warning-journal-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const journal = new WarningJournal(directory);
  cleanup.push(() => journal.close());
  return { directory, journal };
}

it('retains the last 200 warnings across info floods, child loggers and restart', async () => {
  const { directory, journal } = await fixture();
  const logger = withDiagnosticJournal(
    pino({ level: 'info' }, { write() {} }),
    journal,
  );
  const child = logger.child({
    operation: 'scan',
    rootId: '00000000-0000-4000-8000-000000000001',
  });
  for (let i = 0; i < 205; i++) {
    child.warn(
      { code: 'SCAN_PARTIAL', count: i },
      'Private source /Users/Name With Spaces/prompt.png',
    );
    for (let j = 0; j < 50; j++)
      logger.info(
        { request: { url: '/secret?token=private' } },
        'request completed',
      );
  }
  const snapshot = DiagnosticLogsSnapshotSchema.parse(await journal.snapshot());
  expect(snapshot.capture.status).toBe('ok');
  expect(snapshot.entries).toHaveLength(200);
  expect(snapshot.entries.map((entry) => entry.count)).toEqual(
    Array.from({ length: 200 }, (_, i) => i + 5),
  );
  expect(
    snapshot.entries.every(
      (entry) => entry.operation === 'scan' && entry.level === 40,
    ),
  ).toBe(true);
  await journal.close();
  const reopened = new WarningJournal(directory);
  cleanup.push(() => reopened.close());
  expect(await reopened.snapshot()).toEqual(snapshot);
  const bytes = await readFile(
    join(directory, 'diagnostic-warnings.json'),
    'utf8',
  );
  expect(bytes).not.toMatch(
    /Private|Users|prompt\.png|token|request completed/,
  );
  expect(Buffer.byteLength(bytes)).toBeLessThan(200 * 2048);
});

it('captures error and fatal severity while dropping arbitrary messages, codes and fields', async () => {
  const { journal } = await fixture();
  const forwarded: string[] = [];
  const logger = withDiagnosticJournal(
    pino(
      {},
      {
        write(value) {
          forwarded.push(value);
        },
      },
    ),
    journal,
  );
  logger.error(
    {
      operation: 'metadata',
      code: 'METADATA_PARSE_WARNINGS',
      count: 3,
      prompt: 'private prompt',
      err: new Error('private error'),
    },
    'private message',
  );
  logger
    .child({
      operation: 'arbitrary-private-operation',
      assetId: 'private path',
    })
    .fatal(
      { code: 'PRIVATE_SECRET_TOKEN', authorization: 'Bearer private-token' },
      'private fatal',
    );
  const snapshot = await journal.snapshot();
  expect(snapshot.entries.map((entry) => entry.level)).toEqual([50, 60]);
  expect(snapshot.entries[0]).toMatchObject({
    operation: 'metadata',
    code: 'METADATA_PARSE_WARNINGS',
    count: 3,
  });
  expect(snapshot.entries[1]).toMatchObject({
    operation: 'other',
    code: 'UNCLASSIFIED_WARNING',
  });
  expect(JSON.stringify(snapshot)).not.toMatch(/private|PRIVATE_SECRET|Bearer/);
  expect(forwarded).toHaveLength(2);
});

it('reports unreadable retained data explicitly and still collects new safe warnings', async () => {
  const { directory, journal } = await fixture();
  await journal.close();
  await writeFile(
    join(directory, 'diagnostic-warnings.json'),
    '{invalid retained journal',
  );
  const reopened = new WarningJournal(directory);
  cleanup.push(() => reopened.close());
  expect((await reopened.snapshot()).capture).toMatchObject({
    status: 'unavailable',
    code: 'LOG_JOURNAL_READ_FAILED',
  });
  reopened.record({ level: 40, operation: 'scan', code: 'SCAN_PARTIAL' });
  const recovered = await reopened.snapshot();
  expect(recovered.capture).toMatchObject({
    status: 'partial',
    code: 'LOG_JOURNAL_READ_FAILED',
  });
  expect(recovered.entries).toHaveLength(1);
});

it('preserves warnings in memory and reports persistence errors without rejecting logging', async () => {
  const { directory, journal } = await fixture();
  await rm(directory, { recursive: true });
  await writeFile(directory, 'A file now blocks the log directory');
  journal.record({ level: 50, operation: 'http', code: 'EACCES' });
  const snapshot = await journal.snapshot();
  expect(snapshot.capture).toMatchObject({
    status: 'partial',
    code: 'LOG_JOURNAL_WRITE_FAILED',
  });
  expect(snapshot.entries[0]).toMatchObject({ code: 'EACCES', level: 50 });
  await expect(journal.close()).resolves.toBeUndefined();
});

it('retains the Inbox migration category without private filesystem details', async () => {
  const { journal } = await fixture();
  journal.record({
    level: 40,
    operation: 'media',
    code: 'INBOX_MIGRATION_FAILED',
    msg: '/private/Inbox/original.png',
    err: new Error('private error'),
  });
  const snapshot = await journal.snapshot();
  expect(snapshot.entries[0]?.code).toBe('INBOX_MIGRATION_FAILED');
  expect(JSON.stringify(snapshot)).not.toMatch(/private|original/);
});
