import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CatalogStore } from '../src/catalog-store.js';
import { openDatabase } from '../src/database.js';
import { MediaService } from '../src/media/service.js';
import { processFile } from '../src/media/image.js';
import { discoverFiles } from '../src/media/scan.js';
import type { MediaDiagnostic } from '../src/media/types.js';
import { createMetadataPng, textChunk } from './media-fixtures.js';

interface Job {
  id: number;
  kind: string;
  root?: string;
  relativePath?: string;
  dataDir?: string;
  cacheDir?: string;
  knownRelativePaths?: string[];
  sourceName?: string;
}
const transport = vi.hoisted(() => ({
  handle: undefined as ((job: Job) => Promise<unknown>) | undefined,
  workers: [] as EventEmitter[],
}));
vi.mock('node:worker_threads', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  return {
    Worker: class extends Emitter {
      active = false;
      stopping = false;
      constructor() {
        super();
        transport.workers.push(this);
      }
      postMessage(job: Job) {
        if (job.kind === 'shutdown') {
          this.stopping = true;
          if (!this.active) queueMicrotask(() => this.emit('exit', 0));
          return;
        }
        this.active = true;
        void transport.handle!(job)
          .then(
            (result) => {
              this.active = false;
              this.emit('message', { id: job.id, result });
            },
            (error: unknown) => {
              this.active = false;
              this.emit('message', {
                id: job.id,
                error: {
                  message:
                    error instanceof Error ? error.message : String(error),
                  code: (error as NodeJS.ErrnoException)?.code,
                },
              });
            },
          )
          .finally(() => {
            if (this.stopping) this.emit('exit', 0);
          });
      }
    },
  };
});
class Watcher extends EventEmitter {
  async close() {}
}
const cleanup: (() => Promise<unknown>)[] = [];
async function dispatch(job: Job) {
  if (job.kind === 'scan')
    return discoverFiles(job.root!, job.knownRelativePaths ?? []);
  if (job.kind === 'cache-info') return { files: 0, bytes: 0 };
  return processFile({
    filePath: join(job.root!, job.relativePath!),
    dataDir: job.dataDir!,
    cacheDir: job.cacheDir!,
    ...(job.sourceName ? { sourceName: job.sourceName } : {}),
  });
}
beforeEach(() => {
  transport.workers.length = 0;
  transport.handle = dispatch;
  vi.spyOn(chokidar, 'watch').mockImplementation(() => {
    const watcher = new Watcher();
    queueMicrotask(() => watcher.emit('ready'));
    return watcher as unknown as FSWatcher;
  });
});
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});
function held() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  cleanup.push(async () => release());
  return { promise, release };
}
async function setup(
  interrupted = false,
  observer?: (event: MediaDiagnostic) => void,
) {
  const directory = await mkdtemp(join(tmpdir(), 'cura-media-diagnostics-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const paths = {
    data: join(directory, 'data'),
    cache: join(directory, 'cache'),
    log: join(directory, 'log'),
  };
  const db = openDatabase(paths);
  cleanup.push(async () => db.close());
  const store = new CatalogStore(db),
    library = store.createLibrary({ name: 'Diagnostics' });
  const source = join(directory, 'originals');
  await mkdir(source);
  if (interrupted) store.scanStore.start(store.addRoot(library.id, source));
  const diagnostics: MediaDiagnostic[] = [];
  const media = new MediaService(store, paths, (event) => {
    diagnostics.push(event);
    observer?.(event);
  });
  cleanup.push(() => media.close());
  return { directory, paths, store, library, media, source, diagnostics };
}

it('emits metadata and native thumbnail warnings with committed asset/version IDs across import, replacement and rebuild', async () => {
  const { media, library, diagnostics } = await setup();
  const first = await media.upload(
    library.id,
    'PRIVATE_FILE.png',
    createMetadataPng(textChunk('prompt', '{"PRIVATE_PROMPT":')),
  );
  expect(diagnostics).toContainEqual(
    expect.objectContaining({
      level: 'warn',
      operation: 'metadata',
      code: 'METADATA_PARSE_WARNINGS',
      libraryId: library.id,
      assetId: first.id,
      versionId: first.currentVersionId,
    }),
  );
  const replacement = await media.replace(
    first.id,
    'broken.png',
    Buffer.from('PRIVATE_BYTES'),
  );
  expect(diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'NATIVE_THUMBNAIL_FAILED',
      assetId: first.id,
      versionId: replacement.currentVersionId,
    }),
  );
  diagnostics.length = 0;
  await media.rebuildVersions([replacement.currentVersionId]);
  expect(diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'NATIVE_THUMBNAIL_FAILED',
      versionId: replacement.currentVersionId,
    }),
  );
  expect(JSON.stringify(diagnostics)).not.toContain('PRIVATE');
  expect(JSON.stringify(diagnostics)).not.toContain('/');
  diagnostics.length = 0;
  await media.rescan(library.id);
  await expect.poll(() => media.getDiagnostics().activeScans).toBe(0);
  expect(diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'METADATA_PARSE_WARNINGS',
      versionId: first.currentVersionId,
    }),
  );
  expect(
    diagnostics.some(
      (event) =>
        event.code === 'METADATA_PARSE_WARNINGS' &&
        event.versionId === replacement.currentVersionId,
    ),
  ).toBe(false);
});

it('logs accepted browser failures only after revision validation and rejects stale failures without logging them', async () => {
  const { media, library, diagnostics, store } = await setup();
  const asset = await media.upload(
    library.id,
    'frame.mov',
    Buffer.from('deferred browser codec'),
  );
  const failure = {
    sourceHash: asset.hash,
    revision:
      store.getVersionPreview(asset.currentVersionId).previewRevision ?? 0,
    state: 'failed' as const,
    error: 'VIDEO_CODEC' as const,
  };
  media.previewFailure(asset.currentVersionId, failure);
  expect(diagnostics).toEqual([
    expect.objectContaining({
      level: 'warn',
      operation: 'thumbnail',
      code: 'VIDEO_CODEC',
      assetId: asset.id,
      versionId: asset.currentVersionId,
    }),
  ]);
  expect(() => media.previewFailure(asset.currentVersionId, failure)).toThrow();
  expect(diagnostics).toHaveLength(1);
});

it('snapshots actual held worker jobs synchronously and reports shutdown without enqueueing an inspection job', async () => {
  const { media } = await setup();
  const gate = held();
  transport.handle = async (job) => {
    await gate.promise;
    return dispatch(job);
  };
  const first = media.cacheInfo(),
    second = media.cacheInfo(),
    third = media.cacheInfo();
  const all = Promise.allSettled([first, second, third]);
  expect(media.getDiagnostics()).toMatchObject({
    activeJobKind: 'cache-info',
    queuedJobs: 2,
    queuedByKind: {
      scan: 0,
      process: 0,
      preview: 0,
      'cache-info': 2,
      'cache-clear': 0,
    },
    capacity: 64,
    pendingFiles: 0,
    activeScans: 0,
    nativeReservedVersions: 0,
    closed: false,
    workerFailed: false,
    acceptingWork: true,
  });
  const closing = media.close();
  expect(media.getDiagnostics()).toMatchObject({
    closed: true,
    acceptingWork: false,
    queuedJobs: 0,
    activeJobKind: 'cache-info',
  });
  gate.release();
  await all;
  await closing;
  expect(media.getDiagnostics()).toMatchObject({
    closed: true,
    activeJobKind: null,
    queuedJobs: 0,
  });
});

it('exposes native PSD reservations while a retained-version job is held', async () => {
  const { media, library } = await setup();
  const asset = await media.upload(
    library.id,
    'large.psd',
    Buffer.from('8BPS invalid composite'),
  );
  const gate = held();
  transport.handle = async (job) => {
    await gate.promise;
    return dispatch(job);
  };
  const rebuild = media.rebuildVersions([asset.currentVersionId]);
  await expect.poll(() => media.getDiagnostics().activeJobKind).toBe('process');
  expect(media.getDiagnostics()).toMatchObject({
    nativeReservedVersions: 1,
    pendingFiles: 0,
  });
  gate.release();
  await rebuild;
  expect(media.getDiagnostics().nativeReservedVersions).toBe(0);
});

it('records interrupted startup scans before resume and keeps logging observers from breaking work', async () => {
  const observer = vi.fn(() => {
    throw new Error('Observer failure');
  });
  const { media, library, diagnostics } = await setup(true, observer);
  expect(diagnostics).toContainEqual(
    expect.objectContaining({
      operation: 'scan',
      code: 'SCAN_RECOVERED_INTERRUPTED',
    }),
  );
  const asset = await media.upload(
    library.id,
    'corrupt.png',
    Buffer.from('retained'),
  );
  expect(asset.id).toBeTruthy();
  expect(observer).toHaveBeenCalled();
});

it('records partial scan outcomes and exposes active scan work without logging raw paths', async () => {
  const { media, library, source, diagnostics } = await setup();
  const gate = held();
  transport.handle = async (job) => {
    const result = await discoverFiles(job.root!, []);
    await gate.promise;
    result.summary.readErrors = 1;
    result.summary.errors = [
      { relativePath: 'private-folder', stage: 'enumerate', code: 'EACCES' },
    ];
    return result;
  };
  await media.registerRoot(library.id, source);
  expect(media.getDiagnostics()).toMatchObject({
    activeScans: 1,
    activeJobKind: 'scan',
  });
  gate.release();
  await expect.poll(() => media.getDiagnostics().activeScans).toBe(0);
  expect(diagnostics).toContainEqual(
    expect.objectContaining({ operation: 'media', code: 'EACCES' }),
  );
  expect(diagnostics).toContainEqual(
    expect.objectContaining({
      operation: 'scan',
      code: 'SCAN_PARTIAL',
      count: 1,
    }),
  );
  expect(JSON.stringify(diagnostics)).not.toContain('private-folder');
  expect(JSON.stringify(diagnostics)).not.toContain(source);
});

it('reports a failed worker once and closes queue admission without leaking its raw error', async () => {
  const { media, diagnostics } = await setup();
  transport.workers[0]!.emit('error', new Error('PRIVATE_WORKER_PATH /secret'));
  transport.workers[0]!.emit('exit', 1);
  expect(media.getDiagnostics()).toMatchObject({
    workerFailed: true,
    acceptingWork: false,
    activeJobKind: null,
    queuedJobs: 0,
  });
  expect(
    diagnostics.filter((event) => event.code === 'MEDIA_WORKER_FAILED'),
  ).toHaveLength(1);
  expect(JSON.stringify(diagnostics)).not.toContain('PRIVATE');
});

it('reports the exact queue capacity and refuses admission when all waiting slots are occupied', async () => {
  const { media } = await setup();
  const gate = held();
  transport.handle = async (job) => {
    await gate.promise;
    return dispatch(job);
  };
  const jobs = Array.from({ length: 65 }, () => media.cacheInfo());
  const all = Promise.allSettled(jobs);
  expect(media.getDiagnostics()).toMatchObject({
    activeJobKind: 'cache-info',
    queuedJobs: 64,
    acceptingWork: false,
    capacity: 64,
  });
  await expect(media.cacheInfo()).rejects.toMatchObject({
    code: 'MEDIA_QUEUE_FULL',
  });
  expect(media.getDiagnostics().queuedByKind['cache-info']).toBe(64);
  const closing = media.close();
  gate.release();
  await all;
  await closing;
});

it('counts pending file ingestion independently from waiting worker jobs', async () => {
  const { media, library } = await setup();
  const gate = held();
  transport.handle = async (job) => {
    await gate.promise;
    return dispatch(job);
  };
  const upload = media.upload(library.id, 'asset.png', createMetadataPng());
  await expect.poll(() => media.getDiagnostics().pendingFiles).toBe(1);
  expect(media.getDiagnostics()).toMatchObject({
    activeJobKind: 'process',
    pendingFiles: 1,
    queuedJobs: 0,
    activeScans: 0,
  });
  gate.release();
  await upload;
  expect(media.getDiagnostics().pendingFiles).toBe(0);
});
