import { Worker } from 'node:worker_threads';
import { mkdir, realpath, stat, writeFile, unlink } from 'node:fs/promises';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  sep,
} from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import chokidar, { type FSWatcher } from 'chokidar';
import {
  UploadQuerySchema,
  richPreviewFormat,
  type PreviewFailure,
  type Asset,
  type CatalogEvent,
  type LibraryRoot,
} from '@cura/shared';
import type { CatalogStore, VersionFile } from '../catalog-store.js';
import type { UserPaths } from '../paths.js';
import type { ProcessedFile } from './types.js';
import { normalizeRelativePath } from './path-utils.js';

export function fileOperationMessage(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'EPERM' || code === 'EACCES') {
    return 'Permission denied. On macOS, grant your terminal or Node access in System Settings → Privacy & Security → Full Disk Access. On Windows, close applications using the file and check folder permissions.';
  }
  if (code === 'EBUSY')
    return 'The file is in use. Close the application using it and retry.';
  return error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
    ? error.message
    : String(error);
}

interface FileFailure {
  message: string;
  code?: string;
}
interface WorkerResult {
  id: number;
  result?: unknown;
  error?: FileFailure;
}
interface QueuedJob {
  id: number;
  payload: Record<string, unknown>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}
const MAX_QUEUED_JOBS = 64;
function stopped() {
  return Object.assign(new Error('Media service is closed.'), {
    code: 'MEDIA_CLOSED',
    statusCode: 503,
  });
}
function busy() {
  return Object.assign(new Error('Media queue is full. Retry shortly.'), {
    code: 'MEDIA_QUEUE_FULL',
    statusCode: 503,
  });
}
function overlaps(a: string, b: string): boolean {
  const within = (root: string, target: string) => {
    const part = relative(root, target);
    return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
  };
  return within(a, b) || within(b, a);
}
export class MediaService {
  private readonly worker: Worker;
  private readonly workerExit: Promise<void>;
  private sequence = 0;
  private closed = false;
  private closing: Promise<void> | undefined;
  private workerFailure: Error | null = null;
  private activeJob: QueuedJob | undefined;
  private readonly queuedJobs: QueuedJob[] = [];
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly watching = new Map<string, Promise<void>>();
  private readonly listeners = new Set<(event: CatalogEvent) => void>();
  private readonly pending = new Map<
    string,
    { dirty: boolean; removed: boolean; promise: Promise<Asset | null> }
  >();
  private readonly scans = new Map<string, Promise<void>>();
  private readonly reconcileRoots = new Map<string, LibraryRoot>();
  private readonly rootChanges = new Map<string, number>();
  private readonly operations = new Set<Promise<unknown>>();
  private readonly recentErrors: CatalogEvent[] = [];

  constructor(
    private readonly store: CatalogStore,
    private readonly paths: UserPaths,
  ) {
    const compiled = new URL('./worker.js', import.meta.url);
    // Production uses compiled JS; tsx development uses an explicit bootstrap.
    this.worker = existsSync(fileURLToPath(compiled))
      ? new Worker(compiled)
      : new Worker(
          `require('tsx/cjs'); require(${JSON.stringify(fileURLToPath(new URL('./worker.ts', import.meta.url)))});`,
          { eval: true },
        );
    this.workerExit = new Promise((resolve) =>
      this.worker.once('exit', () => resolve()),
    );
    this.worker.on('message', (message: WorkerResult) => {
      const request = this.activeJob;
      if (!request || request.id !== message.id) return;
      this.activeJob = undefined;
      if (message.error)
        request.reject(
          Object.assign(new Error(message.error.message), {
            code: message.error.code,
          }),
        );
      else request.resolve(message.result);
      this.dispatchNext();
      this.reconcile();
    });
    this.worker.on('error', (error) => this.failPending(error));
    this.worker.on('exit', (code) => {
      if (!this.closed || this.activeJob)
        this.failPending(
          new Error(`Media worker exited (${code}). Restart Cura to resume.`),
        );
    });
  }

  private failPending(error: Error) {
    this.workerFailure = error;
    this.activeJob?.reject(error);
    this.activeJob = undefined;
    for (const item of this.queuedJobs.splice(0)) item.reject(error);
  }
  private dispatchNext() {
    if (this.closed || this.workerFailure || this.activeJob) return;
    this.activeJob = this.queuedJobs.shift();
    if (this.activeJob) {
      try {
        this.worker.postMessage({
          ...this.activeJob.payload,
          id: this.activeJob.id,
        });
      } catch (error) {
        this.failPending(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  }
  private job<T>(payload: Record<string, unknown>): Promise<T> {
    if (this.closed) return Promise.reject(stopped());
    if (this.workerFailure) return Promise.reject(this.workerFailure);
    if (this.queuedJobs.length >= MAX_QUEUED_JOBS)
      return Promise.reject(busy());
    return new Promise<T>((resolve, reject) => {
      this.queuedJobs.push({
        id: ++this.sequence,
        payload,
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.dispatchNext();
    });
  }
  private track<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(stopped());
    const running = operation().finally(() => this.operations.delete(running));
    this.operations.add(running);
    return running;
  }
  private reconcile() {
    if (
      this.closed ||
      this.workerFailure ||
      this.pending.size >= MAX_QUEUED_JOBS ||
      this.queuedJobs.length >= MAX_QUEUED_JOBS
    )
      return;
    for (const [id, root] of this.reconcileRoots) {
      if (this.scans.has(id)) continue;
      this.reconcileRoots.delete(id);
      if (this.watchers.has(id)) void this.scan(root);
      break;
    }
  }
  private enqueue(root: LibraryRoot, file: string) {
    if (this.closed || !this.watchers.has(root.id)) return;
    this.rootChanged(root);
    const key = `${root.id}:${file}`;
    if (!this.pending.has(key) && this.pending.size >= MAX_QUEUED_JOBS) {
      this.reconcileRoots.set(root.id, root);
      return;
    }
    void this.ingest(root, file)
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'MEDIA_QUEUE_FULL')
          this.reconcileRoots.set(root.id, root);
        else if (!this.closed) this.reportError(root, error);
      })
      .finally(() => this.reconcile());
  }
  private sourceMissing(root: LibraryRoot, file: string) {
    if (this.closed || !this.watchers.has(root.id)) return;
    this.rootChanged(root);
    const pending = this.pending.get(`${root.id}:${file}`);
    if (pending) {
      pending.removed = true;
      pending.dirty = false;
    }
    try {
      const asset = this.store.markSourceMissing(
        root.id,
        normalizeRelativePath(relative(root.path, file)),
      );
      if (asset)
        this.emit({
          type: 'asset',
          libraryId: root.libraryId,
          rootId: root.id,
          assetId: asset.id,
        });
    } catch (error) {
      this.reportError(root, error);
    }
  }
  private rootChanged(root: LibraryRoot) {
    this.rootChanges.set(root.id, (this.rootChanges.get(root.id) ?? 0) + 1);
    if (this.scans.has(root.id)) this.reconcileRoots.set(root.id, root);
  }
  private reportError(root: LibraryRoot, error: unknown) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    this.emit({
      type: 'error',
      libraryId: root.libraryId,
      rootId: root.id,
      message: fileOperationMessage(error),
      ...(typeof code === 'string' ? { code } : {}),
    });
  }
  private clearRootErrors(rootId: string) {
    for (let index = this.recentErrors.length - 1; index >= 0; index--) {
      if (this.recentErrors[index]?.rootId === rootId)
        this.recentErrors.splice(index, 1);
    }
  }
  private emit(event: CatalogEvent) {
    if (event.type === 'error') {
      this.recentErrors.push(event);
      if (this.recentErrors.length > 100) this.recentErrors.shift();
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* One disconnected client cannot interrupt ingestion. */
      }
    }
  }
  notify(event: CatalogEvent): void {
    this.emit(event);
  }
  subscribe(listener: (event: CatalogEvent) => void): () => void {
    this.listeners.add(listener);
    for (const event of this.recentErrors) {
      try {
        listener(event);
      } catch {
        /* A failed subscriber cannot block recovery. */
      }
    }
    return () => this.listeners.delete(listener);
  }

  async resume(): Promise<void> {
    for (const library of this.store.listLibraries())
      for (const root of this.store.listRoots(library.id)) {
        try {
          await this.watch(root);
          void this.scan(root);
        } catch (error) {
          this.reportError(root, error);
        }
      }
  }
  async registerRoot(libraryId: string, path: string): Promise<LibraryRoot> {
    this.store.getLibrary(libraryId);
    let resolved: string;
    try {
      resolved = await realpath(path);
      if (!(await stat(resolved)).isDirectory())
        throw new Error('Choose a directory.');
    } catch (error) {
      throw Object.assign(new Error(fileOperationMessage(error)), {
        statusCode: ['EPERM', 'EACCES', 'EBUSY'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
          ? 403
          : 400,
        code: (error as NodeJS.ErrnoException).code ?? 'INVALID_DIRECTORY',
      });
    }
    for (const internal of [
      this.paths.data,
      this.paths.cache,
      this.paths.log,
    ]) {
      if (overlaps(resolved, await realpath(internal)))
        throw Object.assign(
          new Error(
            'Choose an asset folder that does not overlap Cura application data.',
          ),
          { statusCode: 400, code: 'INVALID_DIRECTORY' },
        );
    }
    const root = this.store.addRoot(libraryId, resolved, 'reference');
    await this.watch(root);
    void this.scan(root);
    return root;
  }
  private watch(root: LibraryRoot): Promise<void> {
    if (this.closed) return Promise.reject(stopped());
    const initializing = this.watching.get(root.id);
    if (initializing) return initializing;
    if (this.watchers.has(root.id)) return Promise.resolve();
    const running = (async () => {
      await stat(root.path);
      if (this.closed) throw stopped();
      const watcher = chokidar.watch(root.path, {
        ignoreInitial: true,
        followSymlinks: false,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
        atomic: true,
      });
      this.watchers.set(root.id, watcher);
      const remove = async () => {
        if (this.watchers.get(root.id) === watcher)
          this.watchers.delete(root.id);
        await watcher.close();
      };
      watcher
        .on('add', (file) => this.enqueue(root, file))
        .on('change', (file) => this.enqueue(root, file))
        .on('unlink', (file) => this.sourceMissing(root, file));
      watcher.on('error', (error) => {
        this.reportError(root, error);
        void remove().catch(() => undefined);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () =>
              failed(
                new Error(
                  'Folder watcher initialization timed out. Retry the scan.',
                ),
              ),
            10_000,
          );
          const failed = (error: unknown) => {
            clearTimeout(timer);
            watcher.off('ready', ready);
            watcher.off('error', failed);
            reject(error);
          };
          const ready = () => {
            clearTimeout(timer);
            watcher.off('error', failed);
            resolve();
          };
          watcher.once('error', failed);
          watcher.once('ready', ready);
        });
      } catch (error) {
        await remove();
        throw error;
      }
    })().finally(() => this.watching.delete(root.id));
    this.watching.set(root.id, running);
    return running;
  }
  private scan(root: LibraryRoot): Promise<void> {
    const existing = this.scans.get(root.id);
    if (existing) return existing;
    const revision = this.rootChanges.get(root.id) ?? 0;
    const running = (async () => {
      try {
        const { files, errors } = await this.job<{
          files: string[];
          errors: FileFailure[];
        }>({
          kind: 'scan',
          root: root.path,
        });
        for (const failure of errors) this.reportError(root, failure);
        let completed = 0;
        let complete = errors.length === 0;
        this.emit({
          type: 'scan',
          libraryId: root.libraryId,
          rootId: root.id,
          completed,
          total: files.length,
        });
        for (const file of files) {
          if (this.closed || !this.watchers.has(root.id)) break;
          try {
            await this.ingest(root, file);
          } catch (error) {
            complete = false;
            this.reportError(root, error);
          }
          completed++;
          this.emit({
            type: 'scan',
            libraryId: root.libraryId,
            rootId: root.id,
            completed,
            total: files.length,
          });
        }
        if (
          complete &&
          completed === files.length &&
          !this.closed &&
          this.watchers.has(root.id) &&
          revision === (this.rootChanges.get(root.id) ?? 0)
        ) {
          this.clearRootErrors(root.id);
          const assets = this.store.reconcileSources(
            root.id,
            files.map((file) =>
              normalizeRelativePath(relative(root.path, file)),
            ),
          );
          for (const asset of assets)
            this.emit({
              type: 'asset',
              libraryId: root.libraryId,
              rootId: root.id,
              assetId: asset.id,
            });
        }
      } catch (error) {
        this.reportError(root, error);
      } finally {
        this.scans.delete(root.id);
        this.reconcile();
      }
    })();
    this.scans.set(root.id, running);
    return running;
  }
  async rescan(libraryId: string): Promise<void> {
    this.store.getLibrary(libraryId);
    for (const root of this.store.listRoots(libraryId)) {
      await this.watch(root);
      void this.scan(root);
    }
  }
  private ingest(root: LibraryRoot, file: string): Promise<Asset | null> {
    if (this.closed) return Promise.reject(stopped());
    const key = `${root.id}:${file}`;
    const existing = this.pending.get(key);
    if (existing) {
      existing.dirty = true;
      existing.removed = false;
      return existing.promise;
    }
    if (this.pending.size >= MAX_QUEUED_JOBS) return Promise.reject(busy());
    const state = {
      dirty: false,
      removed: false,
      promise: Promise.resolve<Asset | null>(null),
    };
    state.promise = (async () => {
      const diskRelative = relative(root.path, file);
      const identity = normalizeRelativePath(diskRelative);
      let asset: Asset | null = null;
      do {
        state.dirty = false;
        try {
          const processed = await this.job<ProcessedFile>({
            kind: 'process',
            root: root.path,
            relativePath: diskRelative,
            dataDir: this.paths.data,
            cacheDir: this.paths.cache,
          });
          if (state.removed || this.closed || !this.watchers.has(root.id))
            return null;
          const result = this.store.ingest({
            libraryId: root.libraryId,
            rootId: root.id,
            relativePath: identity,
            actualRelativePath: diskRelative,
            processed,
          });
          asset = result.asset;
          if (result.changed) {
            this.emit({
              type: 'asset',
              libraryId: root.libraryId,
              rootId: root.id,
              assetId: asset.id,
            });
            this.emit({
              type: 'thumbnail',
              libraryId: root.libraryId,
              assetId: asset.id,
            });
          }
        } catch (error) {
          if (state.removed) return null;
          if (!state.dirty || this.closed || !this.watchers.has(root.id))
            throw error;
        }
      } while (state.dirty && !this.closed && this.watchers.has(root.id));
      return asset;
    })().finally(() => {
      this.pending.delete(key);
      this.reconcile();
    });
    this.pending.set(key, state);
    return state.promise;
  }
  upload(libraryId: string, name: string, bytes: Buffer): Promise<Asset> {
    return this.track(async () => {
      UploadQuerySchema.parse({ name });
      this.store.getLibrary(libraryId);
      const inbox = join(this.paths.data, 'libraries', libraryId, 'Inbox');
      await mkdir(inbox, { recursive: true });
      const root = this.store.addRoot(
        libraryId,
        await realpath(inbox),
        'inbox',
      );
      await this.watch(root);
      const file = join(root.path, randomUUID(), name);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bytes, { flag: 'wx' });
      const asset = await this.ingest(root, file);
      if (!asset) throw new Error('Import was interrupted.');
      return asset;
    });
  }
  replace(assetId: string, name: string, bytes: Buffer): Promise<Asset> {
    return this.track(async () => {
      UploadQuerySchema.parse({ name });
      const asset = this.store.getAsset(assetId);
      const staging = join(this.paths.data, 'staging');
      await mkdir(staging, { recursive: true });
      const file = join(staging, `${randomUUID()}${extname(name)}`);
      await writeFile(file, bytes, { flag: 'wx' });
      try {
        const processed = await this.job<ProcessedFile>({
          kind: 'process',
          root: await realpath(staging),
          relativePath: basename(file),
          dataDir: this.paths.data,
          cacheDir: this.paths.cache,
        });
        if (this.closed) throw stopped();
        const updated = this.store.replaceAsset(
          assetId,
          processed,
          basename(name),
        );
        this.emit({ type: 'asset', libraryId: asset.libraryId, assetId });
        return updated;
      } finally {
        await unlink(file).catch(() => undefined);
      }
    });
  }
  async unregisterRoot(id: string): Promise<void> {
    await this.watching.get(id)?.catch(() => undefined);
    const watcher = this.watchers.get(id);
    this.watchers.delete(id);
    this.reconcileRoots.delete(id);
    this.rootChanges.delete(id);
    this.clearRootErrors(id);
    await watcher?.close();
    await this.scans.get(id);
    await Promise.allSettled(
      [...this.pending]
        .filter(([key]) => key.startsWith(`${id}:`))
        .map(([, state]) => state.promise),
    );
    this.store.deleteRoot(id);
  }
  submitPreview(
    versionId: string,
    sourceHash: string,
    revision: number,
    bytes: Buffer,
  ): Promise<void> {
    return this.track(async () => {
      this.store.checkPreviewRevision(versionId, sourceHash, revision);
      let result: { thumbnailPath: string };
      try {
        result = await this.job({
          kind: 'preview',
          cacheDir: this.paths.cache,
          bytes,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'INVALID_PREVIEW')
          Object.assign(error as Error, { statusCode: 400 });
        throw error;
      }
      this.store.checkPreviewRevision(versionId, sourceHash, revision);
      this.store.updateVersionPreview(versionId, result.thumbnailPath, {
        state: 'ready',
      });
      const file = this.store.getVersionFile(versionId);
      this.emit({
        type: 'thumbnail',
        libraryId: file.libraryId,
        assetId: file.assetId,
      });
    });
  }
  previewFailure(versionId: string, failure: PreviewFailure): void {
    const version = this.store.checkPreviewRevision(
      versionId,
      failure.sourceHash,
      failure.revision,
    );
    this.store.updateVersionPreview(versionId, null, {
      state: failure.state,
      error: failure.error,
    });
    const file = this.store.getVersionFile(versionId);
    this.emit({
      type: 'thumbnail',
      libraryId: file.libraryId,
      assetId: version.assetId,
    });
  }
  cacheInfo(): Promise<{ files: number; bytes: number }> {
    return this.track(() =>
      this.job({ kind: 'cache-info', cacheDir: this.paths.cache }),
    );
  }
  clearCache(): Promise<void> {
    return this.track(async () => {
      await this.job({ kind: 'cache-clear', cacheDir: this.paths.cache });
      const changed = new Map<string, { libraryId: string; assetId: string }>();
      for (const version of this.store.listAllVersions()) {
        this.store.updateVersionPreview(version.id, null);
        changed.set(version.assetId, version);
      }
      for (const asset of changed.values())
        this.emit({
          type: 'thumbnail',
          libraryId: asset.libraryId,
          assetId: asset.assetId,
        });
    });
  }
  rebuildCache(): Promise<void> {
    return this.rebuildPreviews(this.store.listAllVersions());
  }
  rebuildVersions(versionIds: readonly string[]): Promise<void> {
    return this.rebuildPreviews(
      [...new Set(versionIds)].map((id) => ({
        id,
        ...this.store.getVersionFile(id),
      })),
    );
  }
  private rebuildPreviews(
    versions: ReadonlyArray<VersionFile & { id: string }>,
  ): Promise<void> {
    return this.track(async () => {
      const root = await realpath(this.paths.data);
      for (const version of versions) {
        if (this.closed) throw stopped();
        if (richPreviewFormat(version.name, version.type)) {
          this.store.updateVersionPreview(version.id, null);
          this.emit({
            type: 'thumbnail',
            libraryId: version.libraryId,
            assetId: version.assetId,
          });
          continue;
        }
        const processed = await this.job<ProcessedFile>({
          kind: 'process',
          root,
          relativePath: relative(this.paths.data, version.snapshotPath),
          dataDir: this.paths.data,
          cacheDir: this.paths.cache,
        });
        if (this.closed) throw stopped();
        this.store.updateVersionPreview(version.id, processed.thumbnailPath);
        this.emit({
          type: 'thumbnail',
          libraryId: version.libraryId,
          assetId: version.assetId,
        });
      }
    });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.reconcileRoots.clear();
    this.rootChanges.clear();
    for (const item of this.queuedJobs.splice(0)) item.reject(stopped());
    this.closing = (async () => {
      await Promise.allSettled(this.watching.values());
      await Promise.allSettled(
        [...this.watchers.values()].map((watcher) => watcher.close()),
      );
      this.watchers.clear();
      this.worker.postMessage({ kind: 'shutdown' });
      await this.workerExit;
      await Promise.allSettled([
        ...this.scans.values(),
        ...[...this.pending.values()].map((state) => state.promise),
        ...this.operations,
      ]);
      this.listeners.clear();
    })();
    return this.closing;
  }
}
