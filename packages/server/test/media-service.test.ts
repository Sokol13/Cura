import { EventEmitter } from 'node:events';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import chokidar, { type FSWatcher } from 'chokidar';
import type { CatalogEvent } from '@cura/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CatalogStore } from '../src/catalog-store.js';
import { openDatabase } from '../src/database.js';
import { processFile } from '../src/media/image.js';
import { resolveContained } from '../src/media/path-utils.js';
import { fileOperationMessage, MediaService } from '../src/media/service.js';

interface Payload {
  id: number;
  kind: string;
  root?: string;
  relativePath?: string;
  filePath?: string;
  dataDir?: string;
  cacheDir?: string;
}
const transport = vi.hoisted(() => ({
  dispatch: undefined as ((job: Payload) => Promise<unknown>) | undefined,
  instances: [] as { sent: Payload[]; stopped: boolean; active: number }[],
}));
vi.mock('node:worker_threads', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  return {
    Worker: class extends Emitter {
      sent: Payload[] = [];
      stopped = false;
      active = 0;
      closing = false;
      constructor() {
        super();
        transport.instances.push(this);
      }
      postMessage(job: Payload) {
        this.sent.push(job);
        if (job.kind === 'shutdown') {
          this.closing = true;
          if (!this.active) this.finish();
          return;
        }
        this.active++;
        void transport.dispatch!(job)
          .then(
            (result) => this.emit('message', { id: job.id, result }),
            (error: unknown) =>
              this.emit('message', {
                id: job.id,
                error: {
                  message:
                    error instanceof Error ? error.message : String(error),
                  code: (error as NodeJS.ErrnoException).code,
                },
              }),
          )
          .finally(() => {
            this.active--;
            if (this.closing && !this.active) this.finish();
          });
      }
      finish() {
        if (!this.stopped) {
          this.stopped = true;
          this.emit('exit', 0);
        }
      }
      async terminate() {
        this.finish();
        return 0;
      }
    },
  };
});

class Watcher extends EventEmitter {
  closed = false;
  async close() {
    this.closed = true;
  }
}
const watchers: Watcher[] = [];
const cleanup: (() => Promise<unknown>)[] = [];
let failWatch = false;
let deniedWatchPath: string | undefined;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function enumerate(root: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...(await enumerate(file)));
    else if (entry.isFile()) paths.push(file);
  }
  return paths;
}

async function dispatch(job: Payload) {
  if (job.kind === 'scan')
    return { files: await enumerate(job.root!), errors: [] };
  return processFile({
    filePath: job.relativePath
      ? await resolveContained(job.root!, job.relativePath)
      : job.filePath!,
    dataDir: job.dataDir!,
    cacheDir: job.cacheDir!,
  });
}

beforeEach(() => {
  failWatch = false;
  deniedWatchPath = undefined;
  watchers.length = 0;
  transport.instances.length = 0;
  transport.dispatch = dispatch;
  vi.spyOn(chokidar, 'watch').mockImplementation(() => {
    const watcher = new Watcher();
    watchers.push(watcher);
    queueMicrotask(() => {
      if (failWatch) {
        failWatch = false;
        watcher.emit(
          'error',
          Object.assign(new Error('Denied'), {
            code: 'EACCES',
            path: deniedWatchPath,
          }),
        );
      } else watcher.emit('ready');
    });
    return watcher as unknown as FSWatcher;
  });
});

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'cura-service-'));
  cleanup.push(async () => {
    await expect
      .poll(() => transport.instances.every((worker) => worker.active === 0))
      .toBe(true);
    await rm(directory, { recursive: true, force: true });
  });
  const paths = {
    data: join(directory, 'data'),
    cache: join(directory, 'cache'),
    log: join(directory, 'log'),
  };
  const db = openDatabase(paths);
  cleanup.push(async () => db.close());
  const store = new CatalogStore(db);
  const library = store.createLibrary({ name: 'Service test' });
  const media = new MediaService(store, paths);
  cleanup.push(() => media.close());
  const originals = join(directory, 'originals');
  await mkdir(originals);
  return { directory, paths, store, library, media, originals, db };
}

it('reprocesses a change received after copying an earlier snapshot', async () => {
  const { media, originals, library, store } = await setup();
  await media.registerRoot(library.id, originals);
  const copied = deferred();
  const release = deferred();
  cleanup.push(async () => release.resolve());
  let first = true;
  transport.dispatch = async (job) => {
    const result = await dispatch(job);
    if (job.kind === 'process' && first) {
      first = false;
      copied.resolve();
      await release.promise;
    }
    return result;
  };
  const file = join(originals, 'changing.bin');
  await writeFile(file, 'first');
  watchers[0]!.emit('add', file);
  await copied.promise;
  await writeFile(file, 'second');
  watchers[0]!.emit('change', file);
  release.resolve();
  await expect
    .poll(() => store.listAssets(library.id).items[0]?.size, { timeout: 2000 })
    .toBe(6);
  const asset = store.listAssets(library.id).items[0]!;
  expect(
    await readFile(
      store.getVersionFile(asset.currentVersionId).snapshotPath,
      'utf8',
    ),
  ).toBe('second');
});

it('shares watcher initialization and closes every watcher after concurrent rescans', async () => {
  const { media, library, store, originals } = await setup();
  store.addRoot(library.id, originals, 'reference');
  await Promise.all([media.rescan(library.id), media.rescan(library.id)]);
  await media.close();
  expect(watchers.every((watcher) => watcher.closed)).toBe(true);
});

it('removes failed watchers so a rescan can recover after permission repair', async () => {
  const { media, originals, library } = await setup();
  failWatch = true;
  await expect(media.registerRoot(library.id, originals)).rejects.toThrow(
    'Denied',
  );
  await media.rescan(library.id);
  expect(watchers[0]!.closed).toBe(true);
  expect(watchers.at(-1)).not.toBe(watchers[0]);
});

it('rejects internal descendants and canonical aliases as registered roots', async () => {
  const { media, paths, library } = await setup();
  const nested = join(paths.cache, 'thumbnails');
  await mkdir(nested);
  await expect(media.registerRoot(library.id, nested)).rejects.toThrow(
    /application data/i,
  );
  await expect(media.registerRoot(library.id, nested)).rejects.toMatchObject({
    statusCode: 400,
    code: 'INVALID_DIRECTORY',
  });
  const alias = join(paths.data, '..', 'cache-alias');
  await symlink(
    paths.cache,
    alias,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await expect(media.registerRoot(library.id, alias)).rejects.toThrow(
    /application data/i,
  );
});

it('keeps worker permission codes for actionable messages', async () => {
  const { media, library } = await setup();
  transport.dispatch = async (job) => {
    if (job.kind === 'process')
      throw Object.assign(new Error('Denied'), {
        code: 'EACCES',
        path: deniedWatchPath,
      });
    return dispatch(job);
  };
  const error: unknown = await media
    .upload(library.id, 'denied.bin', Buffer.from('data'))
    .catch((failure: unknown) => failure);
  expect(error).toMatchObject({ code: 'EACCES' });
  expect(fileOperationMessage(error)).toContain('Full Disk Access');
  expect(
    fileOperationMessage({
      message: 'The source disappeared.',
      code: 'ENOENT',
    }),
  ).toBe('The source disappeared.');
});

it('uploads correctly when the configured data directory is a symbolic alias', async () => {
  const { directory, paths, media, library } = await setup();
  const alias = join(directory, 'data-alias');
  await symlink(
    paths.data,
    alias,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  paths.data = alias;
  const asset = await media.upload(
    library.id,
    'aliased.bin',
    Buffer.from('alias bytes'),
  );
  expect(asset.size).toBe(11);
});

it('drains an active worker operation before closing', async () => {
  const { media, library } = await setup();
  const started = deferred();
  const release = deferred();
  cleanup.push(async () => release.resolve());
  transport.dispatch = async (job) => {
    const value = await dispatch(job);
    if (job.kind === 'process') {
      started.resolve();
      await release.promise;
    }
    return value;
  };
  const uploading = media
    .upload(library.id, 'active.bin', Buffer.from('data'))
    .catch(() => null);
  await started.promise;
  let closed = false;
  const closing = media.close().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(closed).toBe(false);
  release.resolve();
  await Promise.all([closing, uploading]);
  expect(transport.instances[0]!.stopped).toBe(true);
});

it('bounds worker messages and reconciles overflowed watcher events', async () => {
  const { media, library, originals, store } = await setup();
  await media.registerRoot(library.id, originals);
  const started = deferred();
  const release = deferred();
  cleanup.push(async () => release.resolve());
  transport.dispatch = async (job) => {
    if (job.kind === 'process') {
      started.resolve();
      await release.promise;
    }
    return dispatch(job);
  };
  for (let index = 0; index < 80; index++) {
    const file = join(originals, `${index}.bin`);
    await writeFile(file, `unique source ${index}`);
    watchers[0]!.emit('add', file);
  }
  await started.promise;
  expect(
    transport.instances[0]!.sent.filter((job) => job.kind === 'process'),
  ).toHaveLength(1);
  release.resolve();
  await expect
    .poll(() => store.listAssets(library.id).total, { timeout: 5000 })
    .toBe(80);
});

it('rebuilds retained trashed versions and persists new cache paths', async () => {
  const { media, originals, paths, library, store } = await setup();
  const root = store.addRoot(library.id, originals, 'reference');
  const file = join(originals, 'image.svg');
  await writeFile(
    file,
    '<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"><rect width="3" height="2" fill="red"/></svg>',
  );
  const processed = await processFile({
    filePath: file,
    dataDir: paths.data,
    cacheDir: paths.cache,
  });
  const { asset } = store.ingest({
    libraryId: library.id,
    rootId: root.id,
    relativePath: 'image.svg',
    actualRelativePath: 'image.svg',
    processed,
  });
  store.batchAssets(library.id, { assetIds: [asset.id], action: 'trash' });
  store.updateVersionPreview(asset.currentVersionId, null);
  await rm(paths.cache, { recursive: true });
  paths.cache = join(paths.cache, '..', 'new-cache');
  await mkdir(paths.cache);
  await media.rebuildCache();
  const rebuilt = store.getVersionFile(asset.currentVersionId);
  expect(rebuilt.thumbnailPath?.startsWith(paths.cache)).toBe(true);
  expect((await readFile(rebuilt.thumbnailPath!)).length).toBeGreaterThan(0);
});

it('rebuilds only newly synced retained versions without registering managed roots or changing metadata', async () => {
  const { media, originals, paths, library, store, db } = await setup();
  const root = store.addRoot(library.id, originals);
  const assets = [];
  for (const color of ['red', 'blue']) {
    const name = `${color}.svg`,
      path = join(originals, name);
    await writeFile(
      path,
      `<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"><rect width="3" height="2" fill="${color}"/></svg>`,
    );
    const processed = await processFile({
      filePath: path,
      dataDir: paths.data,
      cacheDir: paths.cache,
    });
    assets.push(
      store.ingest({
        libraryId: library.id,
        rootId: root.id,
        relativePath: name,
        actualRelativePath: name,
        processed,
      }).asset,
    );
  }
  const asset = assets[0]!;
  store.updateAsset(asset.id, {
    prompt: 'Retained authored prompt',
    note: 'Keep this note',
    displayName: 'Synced label.svg',
  });
  db.sqlite
    .prepare('UPDATE library_roots SET managed=1 WHERE id=?')
    .run(root.id);
  db.sqlite.prepare('DELETE FROM asset_sources WHERE root_id=?').run(root.id);
  for (const item of assets)
    store.updateVersionPreview(item.currentVersionId, null);
  await rm(originals, { recursive: true });
  const before = store.listVersions(asset.id)[0]!;
  const events: CatalogEvent[] = [];
  media.subscribe((event) => events.push(event));
  await media.rebuildVersions([asset.currentVersionId, asset.currentVersionId]);
  expect(
    store.getVersionFile(asset.currentVersionId).thumbnailPath,
  ).not.toBeNull();
  expect(
    store.getVersionFile(assets[1]!.currentVersionId).thumbnailPath,
  ).toBeNull();
  expect(store.listVersions(asset.id)[0]).toMatchObject({
    name: before.name,
    hash: before.hash,
    prompt: before.prompt,
    width: before.width,
    height: before.height,
  });
  expect(store.getAsset(asset.id)).toMatchObject({
    note: 'Keep this note',
    displayName: 'Synced label.svg',
    missing: false,
  });
  expect(store.listRoots(library.id)).toEqual([]);
  expect(watchers).toHaveLength(0);
  expect(events.filter((event) => event.type === 'thumbnail')).toHaveLength(1);
});

it('rechecks source containment when the real worker executes a queued file', async () => {
  const { directory, originals, paths } = await setup();
  const file = join(originals, 'source.bin');
  const outside = join(directory, 'secret.bin');
  await writeFile(file, 'allowed');
  await writeFile(outside, 'secret');
  const canonical = await resolveContained(originals, 'source.bin');
  const { Worker } = await vi.importActual<
    typeof import('node:worker_threads')
  >('node:worker_threads');
  const gate = new SharedArrayBuffer(4);
  const workerFile = fileURLToPath(
    new URL('../src/media/worker.ts', import.meta.url),
  );
  const worker = new Worker(
    `const {workerData}=require('node:worker_threads'); Atomics.wait(new Int32Array(workerData),0,0); require('tsx/cjs'); require(${JSON.stringify(workerFile)});`,
    { eval: true, workerData: gate },
  );
  cleanup.push(() => worker.terminate());
  const reply = new Promise<{ error?: { message: string } }>(
    (resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    },
  );
  worker.postMessage({
    id: 1,
    kind: 'process',
    root: originals,
    relativePath: 'source.bin',
    filePath: canonical,
    dataDir: paths.data,
    cacheDir: paths.cache,
  });
  await unlink(file);
  await symlink(outside, file);
  Atomics.store(new Int32Array(gate), 0, 1);
  Atomics.notify(new Int32Array(gate), 0);
  expect((await reply).error?.message).toMatch(/escape|outside/i);
  const missing = new Promise<{ error: { code: string } }>((resolve) =>
    worker.once('message', resolve),
  );
  worker.postMessage({
    id: 2,
    kind: 'process',
    root: originals,
    relativePath: 'missing.bin',
    dataDir: paths.data,
    cacheDir: paths.cache,
  });
  expect((await missing).error.code).toBe('ENOENT');
  const exited = new Promise<number>((resolve) => worker.once('exit', resolve));
  worker.postMessage({ kind: 'shutdown' });
  expect(await exited).toBe(0);
});

it('keeps one asset when a source is renamed and later edited, then marks deletion missing', async () => {
  const { media, originals, library, store } = await setup();
  await media.registerRoot(library.id, originals);
  const first = join(originals, 'before.bin');
  const next = join(originals, 'after.bin');
  await writeFile(first, 'original');
  watchers[0]!.emit('add', first);
  await expect.poll(() => store.listAssets(library.id).total).toBe(1);
  const original = store.listAssets(library.id).items[0]!;
  await rename(first, next);
  watchers[0]!.emit('unlink', first);
  watchers[0]!.emit('add', next);
  await expect
    .poll(() => store.getAsset(original.id).relativePath)
    .toBe('after.bin');
  await writeFile(next, 'edited original');
  watchers[0]!.emit('change', next);
  await expect.poll(() => store.getAsset(original.id).size).toBe(15);
  expect(store.listAssets(library.id).total).toBe(1);
  expect(store.listVersions(original.id)).toHaveLength(2);
  await unlink(next);
  watchers[0]!.emit('unlink', next);
  expect(store.getAsset(original.id).missing).toBe(true);
  expect(
    await readFile(
      store.getVersionFile(original.currentVersionId).snapshotPath,
      'utf8',
    ),
  ).toBe('original');
});

it('reconciles files removed while the watcher was offline after a complete rescan', async () => {
  const { media, originals, library, store } = await setup();
  const file = join(originals, 'offline.bin');
  await writeFile(file, 'retained');
  await media.registerRoot(library.id, originals);
  await expect.poll(() => store.listAssets(library.id).total).toBe(1);
  const original = store.listAssets(library.id).items[0]!;
  await unlink(file);
  await media.rescan(library.id);
  await expect.poll(() => store.getAsset(original.id).missing).toBe(true);
  expect(store.listVersions(original.id)).toHaveLength(1);
});

it('does not mark sources missing after partial enumeration permission errors', async () => {
  const { media, originals, library, store } = await setup();
  const file = join(originals, 'protected.bin');
  await writeFile(file, 'present');
  await media.registerRoot(library.id, originals);
  await expect.poll(() => store.listAssets(library.id).total).toBe(1);
  const original = store.listAssets(library.id).items[0]!;
  const completed = deferred();
  media.subscribe((event) => {
    if (event.type === 'scan' && event.total === 0) completed.resolve();
  });
  transport.dispatch = async (job) =>
    job.kind === 'scan'
      ? { files: [], errors: [{ code: 'EACCES', message: 'Denied subtree' }] }
      : dispatch(job);
  await media.rescan(library.id);
  await completed.promise;
  expect(store.getAsset(original.id).missing).toBe(false);
});

it('does not reactivate a deleted source when an earlier worker result arrives late', async () => {
  const { media, originals, library, store } = await setup();
  const file = join(originals, 'deleted.bin');
  await writeFile(file, 'original');
  await media.registerRoot(library.id, originals);
  await expect.poll(() => store.listAssets(library.id).total).toBe(1);
  const original = store.listAssets(library.id).items[0]!;
  const copied = deferred();
  const release = deferred();
  cleanup.push(async () => release.resolve());
  transport.dispatch = async (job) => {
    const result = await dispatch(job);
    if (job.kind === 'process') {
      copied.resolve();
      await release.promise;
    }
    return result;
  };
  await writeFile(file, 'edited');
  watchers[0]!.emit('change', file);
  await copied.promise;
  await unlink(file);
  watchers[0]!.emit('unlink', file);
  release.resolve();
  await expect.poll(() => transport.instances[0]!.active).toBe(0);
  expect(store.getAsset(original.id).missing).toBe(true);
  expect(store.getAsset(original.id).hash).toBe(original.hash);
});

it('does not mark a newly watched file missing using an older scan enumeration', async () => {
  const { media, originals, library, store } = await setup();
  await writeFile(join(originals, 'a.bin'), 'first existing');
  await writeFile(join(originals, 'b.bin'), 'second existing');
  await media.registerRoot(library.id, originals);
  await expect.poll(() => store.listAssets(library.id).total).toBe(2);
  const copied = deferred();
  const release = deferred();
  const completed = deferred();
  cleanup.push(async () => release.resolve());
  let first = true;
  transport.dispatch = async (job) => {
    const result = await dispatch(job);
    if (job.kind === 'process' && first) {
      first = false;
      copied.resolve();
      await release.promise;
    }
    return result;
  };
  media.subscribe((event) => {
    if (event.type === 'scan' && event.total === 2 && event.completed === 2)
      completed.resolve();
  });
  await media.rescan(library.id);
  await copied.promise;
  const file = join(originals, 'new.bin');
  await writeFile(file, 'new content');
  watchers[0]!.emit('add', file);
  release.resolve();
  await completed.promise;
  const added = store
    .listAssets(library.id)
    .items.find((asset) => asset.name === 'new.bin');
  expect(added).toBeDefined();
  expect(added?.missing).toBe(false);
});

it('replays bounded startup errors with codes and clears repaired root errors', async () => {
  const { media, originals, library, store } = await setup();
  const root = store.addRoot(library.id, originals, 'reference');
  await rm(originals, { recursive: true });
  for (let index = 0; index < 105; index++) await media.resume();
  const errors: CatalogEvent[] = [];
  const stop = media.subscribe((event) => {
    if (event.type === 'error') errors.push(event);
  });
  expect(errors).toHaveLength(100);
  expect(errors[0]).toMatchObject({ rootId: root.id, code: 'ENOENT' });
  stop();
  await mkdir(originals);
  await media.rescan(library.id);
  await expect
    .poll(() => {
      const replayed: CatalogEvent[] = [];
      media.subscribe((event) => {
        if (event.type === 'error') replayed.push(event);
      })();
      return replayed.length;
    })
    .toBe(0);
});

async function realTransport() {
  const { Worker } = await vi.importActual<
    typeof import('node:worker_threads')
  >('node:worker_threads');
  const workerFile = fileURLToPath(
    new URL('../src/media/worker.ts', import.meta.url),
  );
  const worker = new Worker(
    `require('tsx/cjs'); require(${JSON.stringify(workerFile)});`,
    { eval: true },
  );
  cleanup.push(() => worker.terminate());
  transport.dispatch = (job) =>
    new Promise((resolve, reject) => {
      worker.once(
        'message',
        (message: {
          result?: unknown;
          error?: { message: string; code?: string };
        }) => {
          if (message.error)
            reject(
              Object.assign(new Error(message.error.message), {
                code: message.error.code,
              }),
            );
          else resolve(message.result);
        },
      );
      worker.postMessage(job);
    });
}

it('reports and clears only cached previews while retaining originals and archived snapshots', async () => {
  const { media, paths, library, store } = await setup();
  await realTransport();
  const svg = (color: string) =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="${color}"/></svg>`,
    );
  const original = await media.upload(library.id, 'image.svg', svg('red'));
  await media.replace(original.id, 'next.svg', svg('blue'));
  const versions = store
    .listVersions(original.id)
    .map((version) => store.getVersionFile(version.id));
  const root = store.getRoot(original.rootId!);
  const usage = await media.cacheInfo();
  expect(usage.files).toBe(2);
  expect(usage.bytes).toBeGreaterThan(0);
  await media.clearCache();
  expect(await media.cacheInfo()).toEqual({ files: 0, bytes: 0 });
  expect(await readFile(join(root.path, original.relativePath))).toEqual(
    svg('red'),
  );
  expect(await readFile(versions[0]!.snapshotPath)).toEqual(svg('blue'));
  expect(await readFile(versions[1]!.snapshotPath)).toEqual(svg('red'));
  expect(
    store.listAllVersions().every((version) => version.thumbnailPath === null),
  ).toBe(true);
  await media.rebuildCache();
  expect((await media.cacheInfo()).files).toBe(2);
  expect((await readdir(join(paths.data, 'objects'))).length).toBe(2);
});

it('refuses cache cleanup through a thumbnail-directory symlink to snapshots', async () => {
  const { media, paths, library, store } = await setup();
  await realTransport();
  const asset = await media.upload(
    library.id,
    'preserved.bin',
    Buffer.from('private original'),
  );
  await mkdir(paths.cache, { recursive: true });
  await symlink(
    join(paths.data, 'objects'),
    join(paths.cache, 'thumbnails'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await expect(media.clearCache()).rejects.toThrow(/symlink|cache/i);
  expect(
    await readFile(
      store.getVersionFile(asset.currentVersionId).snapshotPath,
      'utf8',
    ),
  ).toBe('private original');
});

it('drains a root removal without allowing concurrent registration or rescans to restart its watcher', async () => {
  const { media, originals, library, store } = await setup();
  const file = join(originals, 'design.png');
  await writeFile(file, 'retained first version');
  const root = await media.registerRoot(library.id, originals);
  await expect.poll(() => store.listAssets(library.id).total).toBe(1);
  const asset = store.listAssets(library.id).items[0]!;
  const entered = deferred(),
    release = deferred();
  cleanup.push(async () => release.resolve());
  transport.dispatch = async (job) => {
    const result = await dispatch(job);
    if (job.kind === 'process') {
      entered.resolve();
      await release.promise;
    }
    return result;
  };
  await writeFile(file, 'edited while scan was pending');
  await media.rescan(library.id);
  await entered.promise;
  const removal = media.unregisterRoot(root.id);
  await expect(media.registerRoot(library.id, originals)).rejects.toMatchObject(
    { code: 'ROOT_REMOVING', statusCode: 409 },
  );
  await expect(media.rescan(library.id)).rejects.toMatchObject({
    code: 'ROOT_REMOVING',
    statusCode: 409,
  });
  release.resolve();
  await removal;
  expect(watchers).toHaveLength(1);
  expect(watchers[0]!.closed).toBe(true);
  expect(store.listRoots(library.id)).toEqual([]);
  expect(store.listAssets(library.id).total).toBe(0);
  expect(store.listAssets(library.id, { trash: true }).items[0]?.id).toBe(
    asset.id,
  );
  expect(store.getAsset(asset.id).hash).toBe(asset.hash);
  expect(store.listVersions(asset.id)).toHaveLength(1);
  expect(await readFile(file, 'utf8')).toBe('edited while scan was pending');
});

it('marks a registered directory unavailable after it disappears between server runs', async () => {
  const { media, originals, library, store, paths } = await setup();
  await writeFile(join(originals, 'design.png'), 'retained bytes');
  await media.registerRoot(library.id, originals);
  await expect.poll(() => store.listAssets(library.id).total).toBe(1);
  const asset = store.listAssets(library.id).items[0]!;
  await media.close();
  await rm(originals, { recursive: true });
  const restarted = new MediaService(store, paths);
  cleanup.push(() => restarted.close());
  await restarted.resume();
  expect(store.getAsset(asset.id).missing).toBe(true);
  expect(store.getAsset(asset.id).deletedAt).toBeNull();
  expect(
    await readFile(
      store.getVersionFile(asset.currentVersionId).snapshotPath,
      'utf8',
    ),
  ).toBe('retained bytes');
});

it('keeps readable sources online when a watcher permission error concerns only a child', async () => {
  const { media, originals, library, store, paths } = await setup();
  await writeFile(join(originals, 'first.png'), 'first bytes');
  await writeFile(join(originals, 'second.png'), 'second bytes');
  await media.registerRoot(library.id, originals);
  await expect.poll(() => store.listAssets(library.id).total).toBe(2);
  await media.close();
  failWatch = true;
  deniedWatchPath = join(originals, 'private-child');
  const restarted = new MediaService(store, paths);
  cleanup.push(() => restarted.close());
  await restarted.resume();
  expect(
    store.listAssets(library.id).items.map((asset) => asset.missing),
  ).toEqual([false, false]);
});
it('marks old directory sources offline when its path has been replaced by a regular file', async () => {
  const { media, originals, library, store, paths } = await setup();
  await writeFile(join(originals, 'design.png'), 'retained bytes');
  await media.registerRoot(library.id, originals);
  await expect.poll(() => store.listAssets(library.id).total).toBe(1);
  const asset = store.listAssets(library.id).items[0]!;
  await media.close();
  await rm(originals, { recursive: true });
  await writeFile(originals, 'a file replaced this directory');
  const restarted = new MediaService(store, paths);
  cleanup.push(() => restarted.close());
  await restarted.resume();
  expect(store.getAsset(asset.id).missing).toBe(true);
  expect(store.getAsset(asset.id).deletedAt).toBeNull();
});
