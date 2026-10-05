import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { unzipSync, strFromU8 } from 'fflate';
import * as S from '@cura/shared';
import { openDatabase } from '../src/database.js';
import { CatalogStore, type IngestedFile } from '../src/catalog-store.js';
import { MediaService } from '../src/media/service.js';
import { registerCatalogRoutes } from '../src/catalog-routes.js';

const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
const queue: S.MediaQueueDiagnostics = {
  activeJobKind: 'process',
  queuedJobs: 1,
  queuedByKind: {
    scan: 1,
    process: 0,
    preview: 0,
    'cache-info': 0,
    'cache-clear': 0,
  },
  capacity: 64,
  pendingFiles: 2,
  activeScans: 1,
  nativeReservedVersions: 0,
  closed: false,
  workerFailed: false,
  acceptingWork: true,
};
const healthy: S.DatabaseIntegrityDiagnostics = {
  status: 'ok',
  checkedAt: '2026-10-05T00:00:00.000Z',
  durationMs: 0,
  integrityCheck: 'ok',
  foreignKeyCheck: 'ok',
  issues: [],
  truncated: false,
};
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'cura-diagnostics-bundle-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const paths = {
    data: join(directory, 'data'),
    cache: join(directory, 'cache'),
    log: join(directory, 'log'),
  };
  const db = openDatabase(paths);
  cleanups.push(() => db.close());
  const store = new CatalogStore(db),
    library = store.createLibrary({ name: 'PRIVATE_LIBRARY_NAME' }),
    root = store.addRoot(library.id, join(directory, 'PRIVATE_ROOT_NAME'));
  const media = new MediaService(store, paths);
  cleanups.push(() => media.close());
  const app = Fastify();
  cleanups.push(() => app.close());
  return { directory, paths, db, store, library, root, media, app };
}
function unzip(response: Buffer) {
  const zip = unzipSync(response);
  expect(Object.keys(zip).sort()).toEqual(['diagnostics.json', 'logs.json']);
  return {
    diagnostics: S.DiagnosticsSchema.parse(
      JSON.parse(strFromU8(zip['diagnostics.json']!)),
    ),
    logs: S.DiagnosticLogsSnapshotSchema.shape.entries.parse(
      JSON.parse(strFromU8(zip['logs.json']!)),
    ),
    text: Object.values(zip)
      .map((bytes) => strFromU8(bytes))
      .join('\n'),
  };
}
function processed(
  hash: string,
  type = 'image/png',
  thumbnailPath: string | null = null,
): IngestedFile {
  return {
    hash,
    type,
    size: 5,
    width: null,
    height: null,
    colors: [],
    phash: '',
    exif: { private: 'EXIF_SECRET' },
    generation: {
      prompt: 'PROMPT_SECRET',
      negativePrompt: '',
      model: '',
      seed: '',
      source: '',
      params: {},
    },
    snapshotPath: '/PRIVATE_SNAPSHOT',
    thumbnailPath,
  };
}

describe('diagnostics privacy contracts', () => {
  it('accepts bounded safe warning records and rejects arbitrary messages and fields', () => {
    const entry = {
      level: 40,
      time: 1,
      operation: 'scan',
      code: 'EACCES',
      msg: 'A folder scan reported a warning or error.',
    };
    expect(S.DiagnosticLogSchema.parse(entry)).toEqual(entry);
    for (const patch of [
      { msg: 'secret /home/private token123' },
      { level: 30 },
      { code: 'GET https://private.example/key' },
      { path: '/private' },
      { rootId: 'private-folder' },
    ])
      expect(
        S.DiagnosticLogSchema.safeParse({ ...entry, ...patch }).success,
      ).toBe(false);
    expect(
      S.DiagnosticLogsSnapshotSchema.safeParse({
        entries: Array.from({ length: 201 }, () => entry),
        capture: { status: 'ok' },
      }).success,
    ).toBe(false);
  });

  it('checks actual queue counters separately from persisted preview state totals', () => {
    const queue = {
      activeJobKind: 'process',
      queuedJobs: 1,
      queuedByKind: {
        scan: 1,
        process: 0,
        preview: 0,
        'cache-info': 0,
        'cache-clear': 0,
      },
      capacity: 64,
      pendingFiles: 2,
      activeScans: 1,
      nativeReservedVersions: 0,
      closed: false,
      workerFailed: false,
      acceptingWork: true,
    };
    expect(S.MediaQueueDiagnosticsSchema.safeParse(queue).success).toBe(true);
    expect(
      S.MediaQueueDiagnosticsSchema.safeParse({ ...queue, queuedJobs: 2 })
        .success,
    ).toBe(false);
    expect(
      S.MediaQueueDiagnosticsSchema.safeParse({ ...queue, browserActive: 1 })
        .success,
    ).toBe(false);
    expect(
      S.PreviewStateCountsSchema.safeParse({
        total: 3,
        ready: 1,
        pending: 1,
        failed: 0,
        unsupported: 0,
        notApplicable: 1,
      }).success,
    ).toBe(true);
    expect(
      S.PreviewStateCountsSchema.safeParse({
        total: 4,
        ready: 1,
        pending: 1,
        failed: 0,
        unsupported: 0,
        notApplicable: 1,
      }).success,
    ).toBe(false);
  });
});

describe('diagnostics ZIP collector', () => {
  it('uses the real read-only integrity worker and immediate media snapshot by default', async () => {
    const f = await fixture();
    await registerCatalogRoutes(f.app, f.store, f.media, f.paths);
    const { diagnostics } = unzip(
      (await f.app.inject({ url: '/api/diagnostics' })).rawPayload,
    );
    expect(diagnostics.integrity).toMatchObject({
      status: 'ok',
      integrityCheck: 'ok',
      foreignKeyCheck: 'ok',
      issues: [],
    });
    expect(diagnostics.mediaQueue).toMatchObject({
      activeJobKind: null,
      queuedJobs: 0,
      activeScans: 0,
      closed: false,
      workerFailed: false,
    });
    expect(diagnostics.capture.queue.status).toBe('ok');
  });

  it('still downloads the ZIP when the actual integrity worker encounters corrupt SQLite bytes', async () => {
    const f = await fixture();
    const corruptData = join(f.directory, 'PRIVATE_CORRUPT_DATA');
    await mkdir(corruptData);
    await writeFile(
      join(corruptData, 'cura.sqlite'),
      'PRIVATE_CORRUPT_BYTES secret-token /home/private/path',
    );
    await registerCatalogRoutes(f.app, f.store, f.media, {
      ...f.paths,
      data: corruptData,
    });
    const response = await f.app.inject({ url: '/api/diagnostics' });
    expect(response.statusCode).toBe(200);
    const { diagnostics, text } = unzip(response.rawPayload);
    expect(diagnostics.integrity.status).toBe('error');
    expect(diagnostics.stats?.libraries).toBe(1);
    expect(text).not.toMatch(
      /PRIVATE_CORRUPT_BYTES|secret-token|\/home\/private|PRIVATE_CORRUPT_DATA/,
    );
  });

  it('includes active root scan summaries and null history while redacting source paths and excluding removed/managed roots', async () => {
    const f = await fixture();
    const running = f.store.scanStore.start(f.root);
    const finishedAt = new Date().toISOString();
    f.store.scanStore.save({
      ...running,
      status: 'partial',
      phase: 'finished',
      finishedAt,
      updatedAt: finishedAt,
      readErrors: 1,
      errors: [
        {
          relativePath: 'PRIVATE_FILE/PROMPT_SECRET.png',
          stage: 'enumerate',
          code: 'EACCES',
        },
      ],
    });
    const noScan = f.store.addRoot(f.library.id, '/NO_SCAN_ROOT');
    const removed = f.store.addRoot(f.library.id, '/REMOVED_ROOT');
    f.store.deleteRoot(removed.id, 'offline');
    const managed = f.store.addRoot(f.library.id, '/MANAGED_ROOT');
    f.db.sqlite
      .prepare('UPDATE library_roots SET managed=1 WHERE id=?')
      .run(managed.id);
    await registerCatalogRoutes(f.app, f.store, f.media, f.paths, {
      mediaQueueSnapshot: () => queue,
      integrityCheck: async () => healthy,
    });
    const response = await f.app.inject({ url: '/api/diagnostics' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/zip');
    const { diagnostics, logs, text } = unzip(response.rawPayload);
    expect(
      diagnostics.rootScanSummaries.map((row) => row.rootId).sort(),
    ).toEqual([f.root.id, noScan.id].sort());
    expect(
      diagnostics.rootScanSummaries.find((row) => row.rootId === f.root.id)
        ?.latestScanSummary,
    ).toMatchObject({
      status: 'partial',
      readErrors: 1,
      errors: [{ relativePath: null, stage: 'enumerate', code: 'EACCES' }],
    });
    expect(
      diagnostics.rootScanSummaries.find((row) => row.rootId === noScan.id),
    ).toMatchObject({ latestScanSummary: null, capture: { status: 'ok' } });
    expect(diagnostics.pathsRedacted).toBe(true);
    expect(diagnostics.mediaQueue).toEqual(queue);
    expect(diagnostics.capture.logs.status).toBe('unavailable');
    expect(logs).toEqual([]);
    for (const secret of [
      f.directory,
      'PRIVATE_ROOT_NAME',
      'PRIVATE_LIBRARY_NAME',
      'PRIVATE_FILE',
      'PROMPT_SECRET',
      'NO_SCAN_ROOT',
      'REMOVED_ROOT',
      'MANAGED_ROOT',
    ])
      expect(text).not.toContain(secret);
  });

  it('counts all retained preview versions separately from worker activity, including trash and history', async () => {
    const f = await fixture();
    const ingest = (name: string, file: IngestedFile) =>
      f.store.ingest({
        libraryId: f.library.id,
        rootId: f.root.id,
        relativePath: name,
        actualRelativePath: name,
        processed: file,
      }).asset;
    const first = ingest(
      'first.png',
      processed('first', 'image/png', '/PRIVATE_THUMB'),
    );
    const replacement = f.store.replaceAsset(
      first.id,
      processed('replacement', 'image/png'),
      'replacement.png',
    );
    const failed = ingest('failed.png', processed('failed', 'image/png'));
    f.store.updateVersionPreview(failed.currentVersionId, null, {
      state: 'failed',
    });
    const unsupported = ingest(
      'unsupported.obj',
      processed('unsupported', 'model/obj'),
    );
    f.store.updateVersionPreview(unsupported.currentVersionId, null, {
      state: 'unsupported',
    });
    ingest('pending.pdf', processed('pending', 'application/pdf'));
    ingest('notes.txt', processed('generic', 'application/octet-stream'));
    f.store.batchAssets(f.library.id, {
      assetIds: [first.id, failed.id],
      action: 'trash',
    });
    f.store.deleteRoot(f.root.id, 'offline');
    await registerCatalogRoutes(f.app, f.store, f.media, f.paths, {
      mediaQueueSnapshot: () => queue,
      integrityCheck: async () => healthy,
    });
    const { diagnostics, text } = unzip(
      (await f.app.inject({ url: '/api/diagnostics' })).rawPayload,
    );
    expect(diagnostics.previewStates).toEqual({
      total: 6,
      ready: 1,
      pending: 1,
      failed: 1,
      unsupported: 1,
      notApplicable: 2,
    });
    expect(diagnostics.stats?.versions).toBe(6);
    expect(diagnostics.rootScanSummaries).toEqual([]);
    expect(f.store.listVersions(replacement.id)).toHaveLength(2);
    expect(text).not.toContain('PROMPT_SECRET');
    expect(text).not.toContain('EXIF_SECRET');
    expect(text).not.toContain('PRIVATE_THUMB');
  });

  it('retains useful sections when stats, one scan, queue and integrity collection fail', async () => {
    const f = await fixture();
    const running = f.store.scanStore.start(f.root);
    f.db.sqlite
      .prepare('UPDATE root_scan_summaries SET payload=? WHERE root_id=?')
      .run(
        JSON.stringify({ ...running, rootPath: '/PRIVATE_CORRUPT_PATH' }),
        f.root.id,
      );
    const noScan = f.store.addRoot(f.library.id, '/SECOND_PRIVATE');
    vi.spyOn(f.store, 'stats').mockImplementation(() => {
      throw new Error('https://SECRET_URL/token');
    });
    const entry: S.DiagnosticLog = {
      level: 50,
      time: 123,
      operation: 'http',
      code: 'INTERNAL_ERROR',
      msg: S.DIAGNOSTIC_MESSAGES.http,
    };
    await registerCatalogRoutes(f.app, f.store, f.media, f.paths, {
      diagnosticLogs: async () => ({
        entries: [entry],
        capture: { status: 'ok' },
      }),
      mediaQueueSnapshot: () => {
        throw new Error('PRIVATE_QUEUE_REQUEST');
      },
      integrityCheck: async () => {
        throw new Error('PRIVATE_DB_PATH');
      },
    });
    const response = await f.app.inject({ url: '/api/diagnostics' });
    expect(response.statusCode).toBe(200);
    const { diagnostics, logs, text } = unzip(response.rawPayload);
    expect(diagnostics.stats).toBeNull();
    expect(diagnostics.capture.stats.status).toBe('unavailable');
    expect(diagnostics.mediaQueue).toBeNull();
    expect(diagnostics.capture.queue.status).toBe('unavailable');
    expect(diagnostics.capture.scans.status).toBe('partial');
    expect(
      diagnostics.rootScanSummaries.find((row) => row.rootId === noScan.id)
        ?.capture.status,
    ).toBe('ok');
    expect(
      diagnostics.rootScanSummaries.find((row) => row.rootId === f.root.id)
        ?.capture.status,
    ).toBe('unavailable');
    expect(diagnostics.integrity.status).toBe('error');
    expect(logs).toEqual([entry]);
    expect(text).not.toMatch(
      /SECRET_URL|PRIVATE_CORRUPT_PATH|PRIVATE_QUEUE_REQUEST|PRIVATE_DB_PATH|SECOND_PRIVATE/,
    );
  });

  it('caps safe logs at the most recent 200 and rejects private message payloads', async () => {
    const f = await fixture();
    const entries = Array.from({ length: 205 }, (_, index) => ({
      level: 40 as const,
      time: index,
      operation: 'scan' as const,
      code: 'EACCES',
      msg: S.DIAGNOSTIC_MESSAGES.scan,
    }));
    await registerCatalogRoutes(f.app, f.store, f.media, f.paths, {
      diagnosticLogs: async () =>
        ({
          entries: [
            ...entries,
            { ...entries[0]!, msg: 'PRIVATE_LOG_SECRET /home/user/secret' },
          ],
          capture: { status: 'ok' },
        }) as unknown as S.DiagnosticLogsSnapshot,
      mediaQueueSnapshot: () => queue,
      integrityCheck: async () => ({
        ...healthy,
        status: 'timeout',
        integrityCheck: 'not-run',
        foreignKeyCheck: 'not-run',
        code: 'INTEGRITY_TIMEOUT',
      }),
    });
    const { diagnostics, logs, text } = unzip(
      (await f.app.inject({ url: '/api/diagnostics' })).rawPayload,
    );
    expect(logs).toHaveLength(200);
    expect(logs[0]?.time).toBe(5);
    expect(logs.at(-1)?.time).toBe(204);
    expect(diagnostics.capture.logs.status).toBe('partial');
    expect(diagnostics.integrity.status).toBe('timeout');
    expect(text).not.toContain('PRIVATE_LOG_SECRET');
    expect(text).not.toContain('/home/user');
  });
});
