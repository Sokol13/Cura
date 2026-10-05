import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as S from '@cura/shared';
import { openDatabase, type AppDatabase } from '../src/database.js';
import { CatalogStore } from '../src/catalog-store.js';
import { resolveUserPaths } from '../src/paths.js';
import { readPortableGraph } from '../src/sync/portable.js';

const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cura-scan-store-'));
  const paths = resolveUserPaths({
    CURA_DATA_DIR: join(root, 'data'),
    CURA_CACHE_DIR: join(root, 'cache'),
    CURA_LOG_DIR: join(root, 'logs'),
  });
  let db: AppDatabase = openDatabase(paths);
  let store = new CatalogStore(db);
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  cleanups.push(() => db.close());
  const library = store.createLibrary({ name: 'Scan test' });
  const directory = store.addRoot(library.id, '/private/pictures');
  return {
    get db() {
      return db;
    },
    get store() {
      return store;
    },
    library,
    directory,
    reopen() {
      db.close();
      db = openDatabase(paths);
      store = new CatalogStore(db);
    },
  };
}

const startDate = '2026-10-05T01:00:00.000Z';
const endDate = '2026-10-05T01:01:00.000Z';
function summary() {
  return {
    scanId: randomUUID(),
    rootId: randomUUID(),
    libraryId: randomUUID(),
    status: 'completed' as const,
    phase: 'finished' as const,
    recursive: true as const,
    startedAt: startDate,
    finishedAt: endDate,
    createdAt: startDate,
    updatedAt: endDate,
    filesFound: 3,
    supportedFound: 1,
    existingGenericFound: 1,
    unsupportedSkipped: 1,
    processed: 2,
    succeeded: 2,
    readErrors: 0,
    symlinksSkipped: 0,
    specialEntriesSkipped: 0,
    extensions: [
      {
        extension: '.png',
        found: 1,
        supported: 1,
        existingGeneric: 0,
        skipped: 0,
        readErrors: 0,
      },
      {
        extension: '.txt',
        found: 2,
        supported: 0,
        existingGeneric: 1,
        skipped: 1,
        readErrors: 0,
      },
    ],
    otherExtensionFiles: 0,
    errors: [],
    omittedErrors: 0,
  };
}

describe('bounded scan summary contract', () => {
  it('validates counter totals, explicit terminal state and event compatibility', () => {
    const value = summary();
    expect(S.ScanSummarySchema.parse(value)).toEqual(value);
    expect(S.ScanSummariesSchema.parse([value])).toEqual([value]);
    expect(
      S.CatalogEventSchema.parse({
        type: 'scan',
        libraryId: value.libraryId,
        rootId: value.rootId,
        completed: 2,
        total: 2,
        scanSummary: value,
      }).scanSummary,
    ).toEqual(value);
    for (const patch of [
      { filesFound: 4 },
      { supportedFound: 2 },
      { processed: 3 },
      { succeeded: 3 },
      { finishedAt: null },
      { phase: 'processing' },
      { status: 'running' },
      { finishedAt: '2026-10-04T01:00:00.000Z' },
      { updatedAt: '2026-10-04T01:00:00.000Z' },
      { filesFound: -1 },
      { omittedErrors: 1 },
      { rootPath: '/private/pictures' },
    ])
      expect(
        S.ScanSummarySchema.safeParse({ ...value, ...patch }).success,
      ).toBe(false);
  });

  it('accepts bounded partial errors and overflow while rejecting raw messages and unsafe paths', () => {
    const value = {
      ...summary(),
      status: 'partial',
      readErrors: 2,
      errors: [{ relativePath: '设计/é.png', stage: 'read', code: 'EACCES' }],
      omittedErrors: 1,
      extensions: [],
      otherExtensionFiles: 3,
    };
    expect(S.ScanSummarySchema.safeParse(value).success).toBe(true);
    const extension = {
      found: 1,
      supported: 0,
      existingGeneric: 0,
      skipped: 1,
      readErrors: 0,
    };
    expect(
      S.ScanExtensionSchema.safeParse({ ...extension, extension: '' }).success,
    ).toBe(true);
    expect(
      S.ScanExtensionSchema.safeParse({
        ...extension,
        extension: '.' + 'x'.repeat(254),
      }).success,
    ).toBe(true);
    expect(
      S.ScanExtensionSchema.safeParse({
        ...extension,
        extension: '.' + 'x'.repeat(255),
      }).success,
    ).toBe(false);
    expect(
      S.ScanExtensionSchema.safeParse({ ...extension, extension: '.PNG' })
        .success,
    ).toBe(false);
    for (const relativePath of [
      '/home/person/private.png',
      'C:\\Users\\person\\private.png',
      '../private.png',
      'folder/../private.png',
      'a\u0000b',
      'x'.repeat(1025),
    ])
      expect(
        S.ScanSummarySchema.safeParse({
          ...value,
          errors: [{ relativePath, stage: 'read', code: 'EACCES' }],
        }).success,
      ).toBe(false);
    expect(
      S.ScanSummarySchema.safeParse({
        ...value,
        errors: [
          {
            relativePath: null,
            stage: 'enumerate',
            code: 'EACCES',
            message: 'denied /private/path',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      S.ScanSummarySchema.safeParse({
        ...value,
        errors: [
          {
            relativePath: null,
            stage: 'enumerate',
            code: 'Error: /private/path',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      S.ScanSummarySchema.safeParse({
        ...value,
        readErrors: 51,
        omittedErrors: 0,
        errors: Array.from({ length: 51 }, () => ({
          relativePath: null,
          stage: 'enumerate',
          code: 'EACCES',
        })),
      }).success,
    ).toBe(false);
    expect(
      S.ScanSummarySchema.safeParse({
        ...value,
        extensions: Array.from({ length: 65 }, (_, i) => ({
          extension: `.x${i}`,
          found: 0,
          supported: 0,
          existingGeneric: 0,
          skipped: 0,
          readErrors: 0,
        })),
      }).success,
    ).toBe(false);
  });
});

describe('latest scan persistence', () => {
  it('persists latest summary across reopening and rejects stale writes without changing the current run', async () => {
    const f = await fixture();
    expect(f.store.scanStore.get(f.directory.id)).toBeUndefined();
    const first = f.store.scanStore.start(f.directory, startDate);
    expect(first).toMatchObject({
      status: 'running',
      phase: 'enumerating',
      finishedAt: null,
      filesFound: 0,
      recursive: true,
      startedAt: startDate,
    });
    const done = {
      ...first,
      status: 'completed' as const,
      phase: 'finished' as const,
      finishedAt: endDate,
      updatedAt: endDate,
    };
    expect(f.store.scanStore.save(done)).toBe(true);
    expect(f.store.scanStore.save({ ...first, updatedAt: endDate })).toBe(
      false,
    );
    f.reopen();
    expect(f.store.scanStore.get(f.directory.id)).toEqual(done);
    const second = f.store.scanStore.start(f.directory, endDate);
    expect(second.scanId).not.toBe(first.scanId);
    expect(f.store.scanStore.save(done)).toBe(false);
    expect(f.store.scanStore.get(f.directory.id)).toEqual(second);
    expect(
      f.db.sqlite
        .prepare('SELECT count(*) AS n FROM root_scan_summaries')
        .get(),
    ).toEqual({ n: 1 });
  });

  it('interrupts running records only on explicit startup recovery, preserves progress and is idempotent', async () => {
    const f = await fixture();
    const first = f.store.scanStore.start(f.directory, startDate);
    const progress = {
      ...first,
      phase: 'processing' as const,
      filesFound: 1,
      supportedFound: 1,
      otherExtensionFiles: 1,
    };
    f.store.scanStore.save(progress);
    const inbox = f.store.addRoot(f.library.id, '/private/inbox', 'inbox');
    const completed = f.store.scanStore.start(inbox, startDate);
    f.store.scanStore.save({
      ...completed,
      status: 'completed',
      phase: 'finished',
      finishedAt: endDate,
      updatedAt: endDate,
    });
    f.reopen();
    expect(f.store.scanStore.get(f.directory.id)?.status).toBe('running');
    new CatalogStore(f.db);
    expect(f.store.scanStore.get(f.directory.id)?.status).toBe('running');
    const interrupted = f.store.scanStore.interruptRunning();
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0]).toMatchObject({
      ...progress,
      status: 'interrupted',
      phase: 'finished',
      finishedAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(f.store.scanStore.get(inbox.id)?.status).toBe('completed');
    expect(f.store.scanStore.interruptRunning()).toEqual([]);
    expect(
      f.store.scanStore.save({
        ...progress,
        updatedAt: interrupted[0]!.updatedAt,
      }),
    ).toBe(false);
  });

  it('rejects earlier progress and changed run timestamps without overwriting newer counts', async () => {
    const f = await fixture(),
      running = f.store.scanStore.start(f.directory, startDate);
    const newer = {
      ...running,
      phase: 'processing' as const,
      filesFound: 1,
      supportedFound: 1,
      otherExtensionFiles: 1,
      updatedAt: endDate,
    };
    expect(f.store.scanStore.save(newer)).toBe(true);
    expect(f.store.scanStore.save(running)).toBe(false);
    expect(f.store.scanStore.save({ ...newer, createdAt: endDate })).toBe(
      false,
    );
    expect(f.store.scanStore.save({ ...newer, startedAt: endDate })).toBe(
      false,
    );
    expect(f.store.scanStore.get(f.directory.id)).toEqual(newer);
  });

  it('isolates libraries, hides removed roots by default and refuses forged or managed starts', async () => {
    const f = await fixture(),
      secondLibrary = f.store.createLibrary({ name: 'Other' }),
      other = f.store.addRoot(secondLibrary.id, '/elsewhere');
    const first = f.store.scanStore.start(f.directory, startDate),
      second = f.store.scanStore.start(other, startDate);
    expect(f.store.scanStore.list(f.library.id)).toEqual([first]);
    expect(f.store.scanStore.list()).toHaveLength(2);
    expect(
      f.store.scanStore.save({ ...first, libraryId: secondLibrary.id }),
    ).toBe(false);
    expect(() =>
      f.store.scanStore.start({ ...f.directory, libraryId: secondLibrary.id }),
    ).toThrow();
    f.store.deleteRoot(f.directory.id, 'offline');
    expect(f.store.scanStore.list()).toEqual([second]);
    expect(f.store.scanStore.list(f.library.id, true)).toEqual([first]);
    expect(f.store.scanStore.get(f.directory.id)).toEqual(first);
    expect(() => f.store.scanStore.start(f.directory)).toThrow();
    f.db.sqlite
      .prepare('UPDATE library_roots SET managed=1 WHERE id=?')
      .run(other.id);
    expect(() => f.store.scanStore.start(other)).toThrow();
  });

  it('keeps diagnostic scan runs outside portable sync metadata', async () => {
    const f = await fixture();
    const before = readPortableGraph(f.db, f.library.id);
    const running = f.store.scanStore.start(f.directory, startDate);
    f.store.scanStore.save({
      ...running,
      status: 'failed',
      phase: 'finished',
      finishedAt: endDate,
      updatedAt: endDate,
      readErrors: 1,
      errors: [
        { relativePath: 'private-name.png', stage: 'read', code: 'EACCES' },
      ],
    });
    const after = readPortableGraph(f.db, f.library.id);
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain('private-name.png');
  });

  it('lists all normalized source aliases including missing and trashed generic files', async () => {
    const f = await fixture();
    const asset = f.store.ingest({
      libraryId: f.library.id,
      rootId: f.directory.id,
      relativePath: '旧文件/cafe\u0301.txt',
      actualRelativePath: '旧文件/cafe\u0301.txt',
      processed: {
        hash: 'generic',
        size: 5,
        type: 'application/octet-stream',
        width: null,
        height: null,
        colors: [],
        phash: '',
        exif: {},
        generation: {
          prompt: '',
          negativePrompt: '',
          model: '',
          seed: '',
          source: '',
          params: {},
        },
        snapshotPath: '/retained/generic',
        thumbnailPath: null,
      },
    }).asset;
    f.store.markSourceMissing(f.directory.id, asset.relativePath);
    f.store.batchAssets(f.library.id, {
      assetIds: [asset.id],
      action: 'trash',
    });
    expect(f.store.listSourcePaths(f.directory.id)).toEqual([
      '旧文件/café.txt',
    ]);
    f.reopen();
    expect(f.store.listSourcePaths(f.directory.id)).toEqual([
      '旧文件/café.txt',
    ]);
    f.store.deleteRoot(f.directory.id, 'offline');
    expect(() => f.store.listSourcePaths(f.directory.id)).toThrow();
    const managed = f.store.addRoot(f.library.id, '/private/managed');
    f.db.sqlite
      .prepare('UPDATE library_roots SET managed=1 WHERE id=?')
      .run(managed.id);
    expect(() => f.store.listSourcePaths(managed.id)).toThrow();
  });
});
