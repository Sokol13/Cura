import { relative } from 'node:path';
import * as S from '@cura/shared';
import type { AppDatabase } from '../database.js';
import type { UserPaths } from '../paths.js';
import { CatalogStore } from '../catalog-store.js';
import { BoardStore } from '../boards/store.js';
import { resolveContained } from '../media/path-utils.js';
import { SyncAuth } from './auth.js';
import { ensureRemoteObject, materializeObject } from './blobs.js';
import { SyncCloud } from './cloud.js';
import { SyncState, type SyncOperation } from './state.js';
import { SyncError } from './errors.js';
import { mergeGraphs, stableId } from './merge.js';
import {
  payloadHash,
  semanticHash,
  type PortableGraph,
  type SyncFile,
} from './portable.js';
import { snapshotGraph } from './snapshot.js';
import { replayPortableGraph } from './replay.js';

export interface SyncServiceOptions {
  environment?: NodeJS.ProcessEnv;
  intervalMs?: number;
  notify?: (event: S.CatalogEvent) => void;
  rebuildVersions?: (versionIds: readonly string[]) => Promise<void>;
}
const now = () => new Date().toISOString();
const publicError = (error: unknown): S.SyncProblem =>
  error instanceof SyncError
    ? { code: error.code, error: error.message }
    : {
        code: 'SYNC_FAILED',
        error:
          'Synchronization could not finish. Local work and pending transfers are retained.',
      };
export class SyncService {
  readonly auth: SyncAuth;
  readonly state: SyncState;
  private readonly cloud: SyncCloud;
  private readonly running = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  private timer: ReturnType<typeof setInterval> | undefined;
  private closed = false;
  private initialized: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private authChanging = false;
  private authQueue: Promise<void> = Promise.resolve();
  private readonly reschedule = new Set<string>();
  private readonly controls = new Set<{
    controller: AbortController;
    promise: Promise<unknown>;
  }>();
  constructor(
    private readonly database: AppDatabase,
    private readonly paths: UserPaths,
    private readonly options: SyncServiceOptions = {},
  ) {
    this.auth = new SyncAuth(paths, options.environment);
    this.state = new SyncState(database);
    this.cloud = new SyncCloud(() => this.auth.client());
  }
  initialize(): Promise<void> {
    this.initialized ??= this.initializeOnce();
    return this.initialized;
  }
  private async initializeOnce(): Promise<void> {
    await this.auth.initialize();
    if (this.closed) return;
    for (const link of this.state.links(this.auth.projectId))
      if (link.state === 'syncing')
        this.state.update(link.id, {
          state: link.paused ? 'paused' : 'idle',
          phase: null,
        });
    const interval = this.options.intervalMs ?? 15000;
    if (interval > 0) {
      this.timer = setInterval(() => this.poll(), interval);
      this.timer.unref();
    }
    this.poll();
  }
  private poll(): void {
    if (this.closed || this.authChanging || !this.auth.status().account) return;
    for (const link of this.state.links(
      this.auth.projectId,
      this.auth.status().account!.id,
    ))
      if (!link.paused) this.schedule(link.id);
  }
  status(): S.SyncStatus {
    const status = this.auth.status();
    return S.SyncStatusSchema.parse({
      configured: this.auth.configured,
      ...status,
      links: this.state.links(this.auth.projectId, status.account?.id),
    });
  }
  private authChange<T>(task: () => Promise<T>): Promise<T> {
    const operation = this.authQueue.then(async () => {
      this.assertOpen();
      this.authChanging = true;
      for (const value of [...this.running.values(), ...this.controls])
        value.controller.abort();
      await this.idle();
      await Promise.allSettled(
        [...this.controls].map((value) => value.promise),
      );
      try {
        return await task();
      } finally {
        this.authChanging = false;
        this.poll();
      }
    });
    this.authQueue = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }
  private control<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.assertOpen();
    if (this.authChanging)
      throw new SyncError(
        'Cloud account is changing. Try again after sign-in finishes.',
        'SYNC_AUTH_BUSY',
        409,
      );
    const controller = new AbortController(),
      promise = Promise.resolve().then(() => task(controller.signal));
    const item = { controller, promise };
    this.controls.add(item);
    return promise.finally(() => this.controls.delete(item));
  }
  async signIn(input: S.SyncSignIn): Promise<S.SyncStatus> {
    const data = S.SyncSignInSchema.parse(input);
    return this.authChange(async () => {
      await this.auth.signIn(data);
      return this.status();
    });
  }
  async refresh(): Promise<S.SyncStatus> {
    return this.authChange(async () => {
      await this.auth.refresh();
      return this.status();
    });
  }
  async signOut(): Promise<S.SyncStatus> {
    return this.authChange(async () => {
      await this.auth.signOut();
      return this.status();
    });
  }
  private account(): S.SyncAccount {
    const account = this.auth.status().account;
    if (!account)
      throw new SyncError(
        'Sign in to use optional cloud synchronization',
        'SYNC_AUTH_REQUIRED',
        401,
      );
    return account;
  }
  private link(id: string): S.SyncLink {
    return this.state.requireAccount(
      id,
      this.auth.projectId,
      this.account().id,
    );
  }
  async libraries(): Promise<S.CloudLibrary[]> {
    return this.control(async (signal) =>
      (await this.cloud.list(signal))
        .filter((library) => library.published)
        .map(({ published: _published, head: _head, ...library }) => {
          void _published;
          void _head;
          return S.CloudLibrarySchema.parse(library);
        }),
    );
  }
  async publish(input: { libraryId: string }): Promise<S.SyncLink> {
    return this.control(async (signal) => {
      this.check(signal);
      const { libraryId } = S.SyncLibraryRequestSchema.parse(input),
        account = this.account(),
        catalog = new CatalogStore(this.database),
        library = catalog.getLibrary(libraryId);
      // Seed presets before publishing any graph, preserving their portable identities.
      new BoardStore(this.database).listTemplates(libraryId);
      const existing = (await this.cloud.list(signal)).find(
        (value) => value.id === libraryId,
      );
      if (existing?.published) {
        const known = this.state
          .links(this.auth.projectId, account.id)
          .find((link) => link.libraryId === libraryId);
        if (known) return this.run(known.id);
        throw new SyncError(
          'This library already exists in the cloud. Join it to retain both histories.',
          'SYNC_ALREADY_PUBLISHED',
          409,
        );
      }
      const cloud = await this.cloud.create(
        libraryId,
        existing?.name ?? library.name,
        stableId(`${this.auth.projectId}:${account.id}:${libraryId}:create`),
        signal,
      );
      this.check(signal);
      const link = this.state.create(
        libraryId,
        cloud.name,
        cloud.role,
        true,
        this.auth.projectId,
        account.id,
      );
      this.schedule(link.id);
      return this.state.get(link.id);
    });
  }
  async join(input: { libraryId: string }): Promise<S.SyncLink> {
    return this.control(async (signal) => {
      this.check(signal);
      const { libraryId } = S.SyncLibraryRequestSchema.parse(input),
        account = this.account(),
        library = (await this.cloud.list(signal)).find(
          (value) => value.id === libraryId && value.published,
        );
      if (!library)
        throw new SyncError(
          'Shared library is unavailable to this account',
          'SYNC_FORBIDDEN',
          403,
        );
      const exists = Boolean(
        this.database.sqlite
          .prepare('SELECT id FROM libraries WHERE id=?')
          .get(libraryId),
      );
      const link = this.state.create(
        libraryId,
        library.name,
        library.role,
        exists,
        this.auth.projectId,
        account.id,
      );
      this.schedule(link.id);
      return this.state.get(link.id);
    });
  }
  run(id: string): S.SyncLink {
    this.assertOpen();
    const link = this.link(id);
    if (link.paused) return link;
    this.schedule(id, true);
    return this.state.get(id);
  }
  patch(id: string, input: { paused: boolean }): S.SyncLink {
    const data = S.SyncLinkPatchSchema.parse(input);
    this.link(id);
    if (data.paused) this.running.get(id)?.controller.abort();
    const link = this.state.update(id, {
      paused: data.paused,
      state: data.paused ? 'paused' : 'idle',
      phase: null,
    });
    if (!data.paused) this.schedule(id, true);
    return link;
  }
  conflicts(id: string): S.SyncConflictSummary[] {
    this.state.get(id);
    return this.state.conflicts(id);
  }
  conflict(id: string, conflictId: string): S.SyncConflictDetail {
    return this.state.conflict(id, conflictId);
  }
  members(libraryId: string): Promise<S.SyncMember[]> {
    return this.control((signal) =>
      this.cloud.members(S.IdSchema.parse(libraryId), signal),
    );
  }
  async setMember(
    libraryId: string,
    userId: string,
    input: { role: 'editor' | 'viewer' },
  ): Promise<S.SyncMember> {
    return this.control(async (signal) => {
      const data = S.SyncMemberUpsertSchema.parse(input),
        members = await this.cloud.setMember(
          S.IdSchema.parse(libraryId),
          S.IdSchema.parse(userId),
          data.role,
          signal,
        ),
        member = members.find((value) => value.userId === userId);
      if (!member)
        throw new SyncError(
          'Membership update was not acknowledged',
          'SYNC_INVALID_RESPONSE',
          502,
        );
      return member;
    });
  }
  async removeMember(libraryId: string, userId: string): Promise<void> {
    return this.control(async (signal) => {
      await this.cloud.setMember(
        S.IdSchema.parse(libraryId),
        S.IdSchema.parse(userId),
        null,
        signal,
      );
    });
  }
  private assertOpen(): void {
    if (this.closed)
      throw new SyncError(
        'Synchronization is shutting down',
        'SYNC_CLOSED',
        503,
      );
  }
  private schedule(id: string, force = false): void {
    if (this.closed || this.authChanging) return;
    if (this.running.has(id)) {
      if (force) this.reschedule.add(id);
      return;
    }
    const link = this.state.get(id);
    if (link.paused) return;
    const controller = new AbortController();
    this.state.update(id, {
      state: 'syncing',
      phase: 'snapshot',
      lastError: null,
      progress: { completed: 0, total: null },
    });
    const promise = this.synchronize(id, controller.signal)
      .catch((error) => {
        const current = this.state.get(id);
        const problem = publicError(error);
        this.state.update(id, {
          state: current.paused
            ? 'paused'
            : problem.code === 'SYNC_OFFLINE'
              ? 'offline'
              : [
                    'SYNC_FORBIDDEN',
                    'SYNC_AUTH_REQUIRED',
                    'SYNC_AUTH_EXPIRED',
                    'SYNC_ACCOUNT_MISMATCH',
                  ].includes(problem.code)
                ? 'blocked'
                : problem.code === 'SYNC_CANCELLED'
                  ? 'idle'
                  : 'error',
          phase: null,
          lastError: problem.code === 'SYNC_CANCELLED' ? null : problem,
        });
      })
      .finally(() => {
        this.running.delete(id);
        if (
          this.reschedule.delete(id) &&
          !this.closed &&
          !this.authChanging &&
          !this.state.get(id).paused
        )
          this.schedule(id);
      });
    this.running.set(id, { controller, promise });
  }
  private check(signal: AbortSignal): void {
    if (signal.aborted || this.closed)
      throw new SyncError('Sync was cancelled', 'SYNC_CANCELLED', 499);
  }
  private async local(
    link: S.SyncLink,
    signal: AbortSignal,
  ): Promise<{ graph: PortableGraph; semanticHash: string }> {
    if (!link.materialized)
      return {
        graph: { records: [], files: [] },
        semanticHash: semanticHash([]),
      };
    return snapshotGraph(this.paths, link.libraryId, signal);
  }
  private files(
    records: readonly S.PortableRecord[],
  ): Array<Omit<SyncFile, 'source'>> {
    const files = new Map<string, Omit<SyncFile, 'source'>>();
    for (const record of records)
      if (record.kind === 'asset')
        for (const version of record.data.versions) {
          const previous = files.get(version.hash);
          if (previous && previous.size !== version.size)
            throw new SyncError(
              'Same content hash has conflicting file sizes',
              'SYNC_INVALID_GRAPH',
              409,
            );
          files.set(version.hash, {
            hash: version.hash,
            size: version.size,
            type: version.type,
          });
        }
    return [...files.values()];
  }
  private async upload(
    link: S.SyncLink,
    operation: SyncOperation,
    signal: AbortSignal,
  ): Promise<void> {
    const known = new Set(
      this.state
        .baselines(link.id)
        .flatMap((row) => (row.payload ? [row.payload] : []))
        .flatMap((record) =>
          record.kind === 'asset'
            ? record.data.versions.map((v) => `${v.hash}:${v.size}`)
            : [],
        ),
    );
    const files = this.files(
      operation.changes.flatMap((change) =>
        change.payload ? [change.payload] : [],
      ),
    ).filter((file) => !known.has(`${file.hash}:${file.size}`));
    const paths = new Map(
      (
        this.database.sqlite
          .prepare(
            "SELECT v.snapshot_path,json_extract(v.payload,'$.hash') hash FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE a.library_id=?",
          )
          .all(link.libraryId) as Array<{ snapshot_path: string; hash: string }>
      ).map((row) => [row.hash, row.snapshot_path]),
    );
    this.state.update(link.id, {
      phase: 'upload',
      progress: { completed: 0, total: files.length },
    });
    let count = 0;
    for (const file of files) {
      this.check(signal);
      const stored = paths.get(file.hash);
      if (!stored)
        throw new SyncError(
          'Retained content for a pending change is missing',
          'SYNC_BLOB_MISSING',
          404,
        );
      const source = await resolveContained(
        this.paths.data,
        relative(this.paths.data, stored),
      );
      await ensureRemoteObject(
        this.auth.client(),
        link.libraryId,
        { ...file, source },
        signal,
      );
      this.state.update(link.id, {
        progress: { completed: ++count, total: files.length },
      });
    }
  }
  private async submit(
    link: S.SyncLink,
    operation: SyncOperation,
    signal: AbortSignal,
  ): Promise<boolean> {
    await this.upload(link, operation, signal);
    this.check(signal);
    this.state.submitted(operation.id);
    this.state.update(link.id, { phase: 'publish' });
    try {
      const ack = await this.cloud.commit(
        link.libraryId,
        operation.id,
        operation.changes,
        signal,
      );
      this.state.acknowledge(link.id, operation, ack);
      return true;
    } catch (error) {
      if (error instanceof SyncError && error.code === 'SYNC_CONFLICT') {
        this.state.discard(operation.id);
        return false;
      }
      throw error;
    }
  }
  private async applyIncoming(
    link: S.SyncLink,
    remoteRows: S.SyncRemoteRecord[],
    sequence: string,
    operationId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const before = await this.local(link, signal),
      base = this.state
        .baselines(link.id)
        .flatMap((row) => (row.payload ? [row.payload] : [])),
      remote = remoteRows.flatMap((row) => (row.payload ? [row.payload] : []));
    const merged = mergeGraphs(
      link.libraryId,
      link.id,
      operationId,
      base,
      before.graph.records,
      remote,
    );
    const changed =
      semanticHash(merged.records) !== before.semanticHash ||
      !link.materialized;
    const previousVersions = new Set(
      before.graph.records.flatMap((record) =>
        record.kind === 'asset' ? record.data.versions.map((v) => v.id) : [],
      ),
    );
    if (changed) {
      const files = this.files(merged.records);
      this.state.update(link.id, {
        phase: 'download',
        progress: { completed: 0, total: files.length },
      });
      let count = 0;
      for (const file of files) {
        this.check(signal);
        await materializeObject(
          this.auth.client(),
          this.paths,
          link.libraryId,
          file,
          signal,
        );
        this.state.update(link.id, {
          progress: { completed: ++count, total: files.length },
        });
      }
    }
    this.check(signal);
    this.state.update(link.id, { phase: 'apply' });
    this.database.sqlite.transaction(() => {
      if (changed) {
        const replay = replayPortableGraph(
          this.database,
          this.paths,
          link.libraryId,
          merged.records,
          { expectedLocalHash: before.semanticHash },
        );
        this.database.sqlite
          .prepare('UPDATE sync_links SET managed_root_id=? WHERE id=?')
          .run(replay.managedRootId, link.id);
      }
      this.state.saveBaselines(link.id, remoteRows);
      this.state.saveConflicts(link.id, merged.conflicts);
      this.state.clearStage(link.id, sequence);
      this.state.update(link.id, {
        cursor: sequence,
        materialized: true,
        name: merged.records.find((r) => r.kind === 'library')!.data.name,
      });
    })();
    if (changed) {
      for (const record of merged.records) {
        if (record.kind === 'asset')
          this.options.notify?.({
            type: 'asset',
            libraryId: link.libraryId,
            assetId: record.id,
          });
        if (record.kind === 'board')
          this.options.notify?.({
            type: 'board',
            libraryId: link.libraryId,
            boardId: record.id,
          });
      }
      const incoming = merged.records.flatMap((record) =>
        record.kind === 'asset'
          ? record.data.versions
              .filter((v) => !previousVersions.has(v.id))
              .map((v) => v.id)
          : [],
      );
      if (incoming.length && this.options.rebuildVersions)
        await this.options.rebuildVersions(incoming);
    }
  }
  private async pull(link: S.SyncLink, signal: AbortSignal): Promise<void> {
    if (!link.materialized) {
      const manifest = await this.cloud.manifest(link.libraryId, signal);
      if (!manifest.library.published)
        throw new SyncError(
          'Cloud library publication has not completed',
          'SYNC_BOOTSTRAP_PENDING',
          409,
        );
      this.state.update(link.id, { role: manifest.library.role });
      await this.applyIncoming(
        link,
        manifest.records,
        manifest.sequence,
        stableId(`${link.libraryId}:${manifest.sequence}:bootstrap`),
        signal,
      );
      return;
    }
    let current = this.state.get(link.id);
    for (let page = 0; page < 1000; page++) {
      this.check(signal);
      const response = await this.cloud.pull(
        link.libraryId,
        current.cursor,
        signal,
      );
      if (response.commits.length === 0) return;
      const heads = new Map(
        this.state
          .baselines(link.id)
          .map((row) => [`${row.kind}:${row.key}`, row]),
      );
      for (const commit of response.commits) {
        this.state.stage(link.id, commit);
        for (const change of commit.changes) {
          const key = `${change.kind}:${change.key}`,
            old = heads.get(key);
          if (!old || BigInt(change.revision) > BigInt(old.revision))
            heads.set(key, change);
          else if (
            change.revision === old.revision &&
            payloadHash(change.payload) !== payloadHash(old.payload)
          )
            throw new SyncError(
              'Cloud revision has inconsistent metadata',
              'SYNC_INVALID_RESPONSE',
              502,
            );
        }
      }
      await this.applyIncoming(
        current,
        [...heads.values()],
        response.cursor,
        response.commits.at(-1)!.operationId,
        signal,
      );
      current = this.state.get(link.id);
      if (!response.hasMore) return;
    }
    throw new SyncError(
      'Cloud backlog exceeds one sync cycle; run sync again to continue',
      'SYNC_BACKLOG',
      409,
    );
  }
  private async synchronize(id: string, signal: AbortSignal): Promise<void> {
    let link = this.link(id);
    const remote = (await this.cloud.list(signal)).find(
      (library) => library.id === link.libraryId,
    );
    if (!remote)
      throw new SyncError(
        'This account no longer has access to the cloud library',
        'SYNC_FORBIDDEN',
        403,
      );
    link = this.state.update(id, { role: remote.role });
    let pending = this.state.pending(id);
    if (pending && link.role !== 'viewer')
      await this.submit(link, pending, signal);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await this.pull(this.state.get(id), signal);
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'SYNC_LOCAL_CHANGED'
        )
          continue;
        throw error;
      }
      link = this.state.get(id);
      const snapshot = await this.local(link, signal),
        changes = this.state.changes(id, snapshot.graph.records);
      this.state.update(id, { pendingChanges: changes.length });
      if (link.role === 'viewer') {
        this.state.update(id, {
          state: 'idle',
          phase: null,
          lastSyncedAt: now(),
          lastError: changes.length
            ? {
                code: 'VIEWER_READ_ONLY',
                error:
                  'Local edits are retained on this device. Viewers can download cloud updates.',
              }
            : null,
        });
        return;
      }
      pending = this.state.pending(id);
      if (!pending && changes.length === 0) {
        this.state.update(id, {
          state: 'idle',
          phase: null,
          lastSyncedAt: now(),
          lastError: null,
        });
        return;
      }
      pending ??= this.state.enqueue(id, changes);
      if (await this.submit(link, pending, signal)) continue;
    }
    // Sustained local/remote editing is retried on the next cycle without dropping work.
    this.state.update(id, {
      state: 'idle',
      phase: null,
      lastError: {
        code: 'SYNC_RETRY_PENDING',
        error:
          'New edits arrived during sync. The next cycle will continue from the saved cursor.',
      },
    });
  }
  async idle(): Promise<void> {
    while (this.running.size)
      await Promise.all(
        [...this.running.values()].map((operation) => operation.promise),
      );
  }
  close(): Promise<void> {
    this.closing ??= this.closeOnce();
    return this.closing;
  }
  private async closeOnce(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    for (const operation of [...this.running.values(), ...this.controls])
      operation.controller.abort();
    // Auth mutations may be waiting for startup restoration, so abort Auth
    // before waiting for its queue. All completions drain before the DB closes.
    const authClosing = this.auth.close();
    await this.idle();
    await Promise.allSettled([...this.controls].map((value) => value.promise));
    await this.authQueue;
    await Promise.allSettled([this.initialized]);
    await authClosing;
  }
}
