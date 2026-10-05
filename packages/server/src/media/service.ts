import { Worker } from 'node:worker_threads';
import {
  mkdir,
  opendir,
  realpath,
  stat,
  writeFile,
  unlink,
} from 'node:fs/promises';
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
  type RootRemovalMode,
  type RemoveRootResult,
  type ScanSummary,
  type MediaQueueDiagnostics,
} from '@cura/shared';
import type { CatalogStore, VersionFile } from '../catalog-store.js';
import type { UserPaths } from '../paths.js';
import {
  MEDIA_FAILURE_CODES,
  type MediaDiagnostic,
  type ProcessedFile,
} from './types.js';
import { normalizeRelativePath } from './path-utils.js';
import { shouldAutoImport, type ScanDiscovery } from './scan.js';
import { addScanFailure } from './scan-summary.js';

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
function rootRemoving() {
  return Object.assign(
    new Error('This directory is being removed. Retry when removal finishes.'),
    {
      code: 'ROOT_REMOVING',
      statusCode: 409,
    },
  );
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
  private readonly nativePreviews = new Map<string, number>();
  private readonly removingRoots = new Map<string, Promise<RemoveRootResult>>();

  constructor(
    private readonly store: CatalogStore,
    private readonly paths: UserPaths,
    private readonly onDiagnostic?: (event: MediaDiagnostic) => void,
  ) {
    for (const summary of this.store.scanStore.interruptRunning())
      this.diagnostic({
        level: 'warn',
        operation: 'scan',
        code: 'SCAN_RECOVERED_INTERRUPTED',
        libraryId: summary.libraryId,
        rootId: summary.rootId,
        count: summary.processed,
      });
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

  private diagnostic(event: MediaDiagnostic): void {
    try {
      this.onDiagnostic?.(event);
    } catch {
      /* Diagnostics must never interrupt media work. */
    }
  }
  private processedDiagnostics(
    processed: ProcessedFile,
    context: Pick<
      MediaDiagnostic,
      'libraryId' | 'rootId' | 'assetId' | 'versionId'
    >,
  ): void {
    for (const event of processed.diagnostics ?? [])
      this.diagnostic({ ...event, ...context, level: 'warn' });
  }
  getDiagnostics(): MediaQueueDiagnostics {
    const queuedByKind: MediaQueueDiagnostics['queuedByKind'] = {
      scan: 0,
      process: 0,
      preview: 0,
      'cache-info': 0,
      'cache-clear': 0,
    };
    for (const job of this.queuedJobs)
      queuedByKind[job.payload.kind as keyof typeof queuedByKind]++;
    return {
      activeJobKind: this.activeJob
        ? (this.activeJob.payload
            .kind as MediaQueueDiagnostics['activeJobKind'])
        : null,
      queuedJobs: this.queuedJobs.length,
      queuedByKind,
      capacity: MAX_QUEUED_JOBS,
      pendingFiles: this.pending.size,
      activeScans: this.scans.size,
      nativeReservedVersions: this.nativePreviews.size,
      closed: this.closed,
      workerFailed: this.workerFailure !== null,
      acceptingWork:
        !this.closed &&
        !this.workerFailure &&
        this.queuedJobs.length < MAX_QUEUED_JOBS,
    };
  }
  private failPending(error: Error) {
    if (!this.workerFailure)
      this.diagnostic({
        level: 'error',
        operation: 'media',
        code: 'MEDIA_WORKER_FAILED',
      });
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
      if (this.watchers.has(id) && !this.removingRoots.has(id))
        void this.scan(root);
      break;
    }
  }
  private enqueue(root: LibraryRoot, file: string) {
    if (
      this.closed ||
      this.removingRoots.has(root.id) ||
      !this.watchers.has(root.id)
    )
      return;
    try {
      if (
        !shouldAutoImport(file) &&
        !this.store.getSource(
          root.id,
          normalizeRelativePath(relative(root.path, file)),
        )
      )
        return;
    } catch (error) {
      this.reportError(root, error);
      return;
    }
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
    this.diagnostic({
      level: 'warn',
      operation: 'media',
      code:
        MEDIA_FAILURE_CODES.find((candidate) => candidate === code) ??
        'MEDIA_OPERATION_FAILED',
      libraryId: root.libraryId,
      rootId: root.id,
    });
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
  private async markRootUnavailable(
    root: LibraryRoot,
    error: unknown,
  ): Promise<void> {
    const codes = ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ROOT_CHANGED'];
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (this.closed || !codes.includes(code ?? '')) return;
    await this.track(async () => {
      // Watchers also report denied children. Confirm the root itself is unusable
      // before clearing availability for every source beneath it.
      let unavailable = false;
      try {
        const canonical = await realpath(root.path);
        if (relative(root.path, canonical)) unavailable = true;
        else {
          const directory = await opendir(root.path);
          await directory.close();
        }
      } catch (failure) {
        unavailable = codes.includes(
          (failure as NodeJS.ErrnoException).code ?? '',
        );
      }
      if (!unavailable || this.closed || this.removingRoots.has(root.id))
        return;
      try {
        this.store.getRoot(root.id);
      } catch {
        return; // Ignore late errors from a root already removed elsewhere.
      }
      for (const asset of this.store.reconcileSources(root.id, []))
        this.emit({
          type: 'asset',
          libraryId: root.libraryId,
          rootId: root.id,
          assetId: asset.id,
        });
    });
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
          this.recordScanStartFailure(root, error);
          await this.markRootUnavailable(root, error);
          this.reportError(root, error);
        }
      }
    // Upgrade failed browser PSD previews from retained bytes without delaying startup.
    const versions = this.store
      .listAllVersions()
      .filter(
        (version) =>
          !version.thumbnailPath &&
          richPreviewFormat(version.name, version.type) === 'psd',
      );
    void this.reserveNativePreviews(versions, () =>
      this.track(async () => {
        for (const version of versions) {
          if (this.closed) break;
          try {
            await this.rebuildPreviews([version]);
          } catch (error) {
            if (!this.closed) {
              this.diagnostic({
                level: 'warn',
                operation: 'thumbnail',
                code: 'PSD_PREVIEW_RECOVERY',
                libraryId: version.libraryId,
                assetId: version.assetId,
                versionId: version.id,
              });
              this.emit({
                type: 'error',
                libraryId: version.libraryId,
                assetId: version.assetId,
                code: 'PSD_PREVIEW_RECOVERY',
                message: fileOperationMessage(error),
              });
            }
          }
        }
      }),
    ).catch(() => undefined);
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
    const existing = this.store
      .listRoots(libraryId)
      .find((root) => root.path === resolved);
    if (existing && this.removingRoots.has(existing.id)) throw rootRemoving();
    const root = this.store.addRoot(libraryId, resolved, 'reference');
    try {
      await this.watch(root);
    } catch (error) {
      this.recordScanStartFailure(root, error);
      throw error;
    }
    if (this.removingRoots.has(root.id)) throw rootRemoving();
    this.store.getRoot(root.id);
    void this.scan(root);
    return root;
  }
  private watch(root: LibraryRoot): Promise<void> {
    if (this.closed) return Promise.reject(stopped());
    if (this.removingRoots.has(root.id)) return Promise.reject(rootRemoving());
    const initializing = this.watching.get(root.id);
    if (initializing) return initializing;
    if (this.watchers.has(root.id)) return Promise.resolve();
    const running = (async () => {
      if (!(await stat(root.path)).isDirectory())
        throw Object.assign(
          new Error('Registered directory is no longer a directory.'),
          { code: 'ENOTDIR' },
        );
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
        void this.markRootUnavailable(root, error).catch(() => undefined);
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
  private publishScan(summary: ScanSummary): void {
    summary.updatedAt = new Date(
      Math.max(Date.now(), Date.parse(summary.updatedAt)),
    ).toISOString();
    if (!this.store.scanStore.save(summary)) return;
    this.emit({
      type: 'scan',
      libraryId: summary.libraryId,
      rootId: summary.rootId,
      completed: summary.processed,
      total: summary.supportedFound + summary.existingGenericFound,
      scanId: summary.scanId,
      status: summary.status,
      scanSummary: structuredClone(summary),
    });
  }
  private finishScan(
    summary: ScanSummary,
    status: ScanSummary['status'],
  ): void {
    summary.status = status;
    summary.phase = 'finished';
    summary.finishedAt = new Date(
      Math.max(Date.now(), Date.parse(summary.updatedAt)),
    ).toISOString();
    this.publishScan(summary);
    if (status !== 'completed')
      this.diagnostic({
        level: 'warn',
        operation: 'scan',
        code:
          status === 'partial'
            ? 'SCAN_PARTIAL'
            : status === 'failed'
              ? 'SCAN_FAILED'
              : 'SCAN_INTERRUPTED',
        libraryId: summary.libraryId,
        rootId: summary.rootId,
        count: summary.readErrors,
      });
  }
  private recordScanStartFailure(root: LibraryRoot, error: unknown): void {
    if (
      this.closed ||
      this.removingRoots.has(root.id) ||
      this.scans.has(root.id)
    )
      return;
    try {
      this.store.getRoot(root.id);
    } catch {
      return;
    }
    const summary = this.store.scanStore.start(root);
    addScanFailure(summary, null, 'enumerate', error);
    this.finishScan(summary, 'failed');
  }
  private scan(root: LibraryRoot): Promise<void> {
    if (
      this.closed ||
      this.removingRoots.has(root.id) ||
      !this.watchers.has(root.id)
    )
      return Promise.resolve();
    const existing = this.scans.get(root.id);
    if (existing) return existing;
    const revision = this.rootChanges.get(root.id) ?? 0;
    const summary = this.store.scanStore.start(root);
    this.publishScan(summary);
    const active = () =>
      !this.closed &&
      !this.removingRoots.has(root.id) &&
      this.watchers.has(root.id);
    const running = (async () => {
      let outcome: ScanSummary['status'] = 'failed';
      try {
        const discovery = await this.job<ScanDiscovery>({
          kind: 'scan',
          root: root.path,
          knownRelativePaths: this.store.listSourcePaths(root.id),
        });
        Object.assign(summary, discovery.summary, { phase: 'processing' });
        for (const failure of summary.errors)
          this.reportError(
            root,
            Object.assign(
              new Error(
                'A directory entry could not be read. See its scan summary.',
              ),
              { code: failure.code },
            ),
          );
        this.publishScan(summary);
        let lastProgress = performance.now();
        let interrupted = discovery.interrupted;
        for (const file of discovery.files) {
          if (interrupted || !active()) {
            interrupted = true;
            break;
          }
          try {
            const asset = await this.ingest(root, file);
            if (!active()) {
              interrupted = true;
              break;
            }
            if (asset) summary.succeeded++;
            else
              addScanFailure(
                summary,
                normalizeRelativePath(relative(root.path, file)),
                'read',
                { code: 'SOURCE_UNAVAILABLE' },
              );
          } catch (error) {
            if (!active()) {
              interrupted = true;
              break;
            }
            addScanFailure(
              summary,
              relative(root.path, file).split(sep).join('/').normalize('NFC'),
              'read',
              error,
            );
            this.reportError(root, error);
          }
          summary.processed++;
          if (performance.now() - lastProgress >= 250) {
            this.publishScan(summary);
            lastProgress = performance.now();
          }
        }
        interrupted ||= !active();
        outcome = interrupted
          ? 'interrupted'
          : summary.readErrors
            ? 'partial'
            : 'completed';
        if (
          outcome === 'completed' &&
          revision === (this.rootChanges.get(root.id) ?? 0)
        ) {
          this.clearRootErrors(root.id);
          const assets = this.store.reconcileSources(
            root.id,
            discovery.presentRelativePaths,
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
        if (!active()) outcome = 'interrupted';
        else {
          outcome = 'failed';
          addScanFailure(summary, null, 'enumerate', error);
          await this.markRootUnavailable(root, error);
          this.reportError(root, error);
        }
      } finally {
        try {
          this.finishScan(summary, outcome);
        } catch {
          this.reportError(
            root,
            Object.assign(
              new Error('The scan summary could not be saved. Retry the scan.'),
              {
                code: 'SCAN_SAVE_FAILED',
              },
            ),
          );
        } finally {
          this.scans.delete(root.id);
          this.reconcile();
        }
      }
    })();
    this.scans.set(root.id, running);
    return running;
  }
  async rescan(libraryId: string): Promise<void> {
    this.store.getLibrary(libraryId);
    for (const root of this.store.listRoots(libraryId)) {
      try {
        await this.watch(root);
      } catch (error) {
        this.recordScanStartFailure(root, error);
        await this.markRootUnavailable(root, error);
        throw error;
      }
      if (this.removingRoots.has(root.id)) throw rootRemoving();
      this.store.getRoot(root.id);
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
          if (processed.diagnostics?.length) {
            const versionId =
              asset.hash === processed.hash
                ? asset.currentVersionId
                : this.store
                    .listVersions(asset.id)
                    .find((version) => version.hash === processed.hash)?.id;
            this.processedDiagnostics(processed, {
              libraryId: root.libraryId,
              rootId: root.id,
              assetId: asset.id,
              ...(versionId ? { versionId } : {}),
            });
          }
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
        this.processedDiagnostics(processed, {
          libraryId: asset.libraryId,
          assetId,
          versionId: updated.currentVersionId,
        });
        this.emit({ type: 'asset', libraryId: asset.libraryId, assetId });
        return updated;
      } finally {
        await unlink(file).catch(() => undefined);
      }
    });
  }
  async unregisterRoot(
    id: string,
    mode: RootRemovalMode = 'trash',
  ): Promise<RemoveRootResult> {
    if (this.removingRoots.has(id)) throw rootRemoving();
    this.store.getRoot(id);
    const running = this.track(async () => {
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
      if (this.closed) throw stopped();
      const result = this.store.deleteRoot(id, mode);
      this.emit({ type: 'asset', libraryId: result.libraryId, rootId: id });
      return result;
    }).finally(() => this.removingRoots.delete(id));
    this.removingRoots.set(id, running);
    return running;
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
    this.diagnostic({
      level: 'warn',
      operation: 'thumbnail',
      code: failure.error,
      libraryId: file.libraryId,
      assetId: version.assetId,
      versionId,
    });
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
      const versions = this.store.listAllVersions();
      for (const version of versions) {
        this.store.updateVersionPreview(version.id, null);
        changed.set(version.assetId, version);
      }
      for (const asset of changed.values())
        this.emit({
          type: 'thumbnail',
          libraryId: asset.libraryId,
          assetId: asset.assetId,
        });
      await this.rebuildPreviews(
        versions.filter(
          (version) => richPreviewFormat(version.name, version.type) === 'psd',
        ),
      );
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
  listPendingPreviews(libraryId: string) {
    return this.store.listPendingPreviews(libraryId, [
      ...this.nativePreviews.keys(),
    ]);
  }
  private async reserveNativePreviews<T>(
    versions: ReadonlyArray<VersionFile & { id: string }>,
    operation: () => Promise<T>,
  ): Promise<T> {
    const ids = [
      ...new Set(
        versions
          .filter(
            (version) =>
              richPreviewFormat(version.name, version.type) === 'psd',
          )
          .map((version) => version.id),
      ),
    ];
    for (const id of ids)
      this.nativePreviews.set(id, (this.nativePreviews.get(id) ?? 0) + 1);
    try {
      return await operation();
    } finally {
      for (const id of ids) {
        const count = this.nativePreviews.get(id)! - 1;
        if (count) this.nativePreviews.set(id, count);
        else this.nativePreviews.delete(id);
      }
    }
  }
  private rebuildPreviews(
    versions: ReadonlyArray<VersionFile & { id: string }>,
  ): Promise<void> {
    return this.reserveNativePreviews(versions, () =>
      this.track(async () => {
        const root = await realpath(this.paths.data);
        for (const version of versions) {
          if (this.closed) throw stopped();
          const format = richPreviewFormat(version.name, version.type);
          if (format && format !== 'psd') {
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
            sourceName: version.name,
            dataDir: this.paths.data,
            cacheDir: this.paths.cache,
          });
          if (this.closed) throw stopped();
          this.store.updateVersionPreview(version.id, processed.thumbnailPath);
          this.processedDiagnostics(processed, {
            libraryId: version.libraryId,
            assetId: version.assetId,
            versionId: version.id,
          });
          this.emit({
            type: 'thumbnail',
            libraryId: version.libraryId,
            assetId: version.assetId,
          });
        }
      }),
    );
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
