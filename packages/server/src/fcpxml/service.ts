import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import * as C from '@cura/shared';
import type { AppDatabase } from '../database.js';
import type { UserPaths } from '../paths.js';
import { CatalogError, CatalogStore } from '../catalog-store.js';
import {
  FcpxmlValidationError,
  readFcpxmlSnapshot,
  type FcpxmlSnapshot,
} from './snapshot.js';
const now = () => new Date().toISOString();
interface Message {
  progress?: number;
  bytes?: number;
  timing?: C.FcpxmlVideoTiming;
  error?: string;
  problems?: C.FcpxmlProblem[];
}
export class FcpxmlService {
  private readonly running = new Map<string, Promise<unknown>>();
  private closing = false;
  constructor(
    private readonly database: AppDatabase,
    private readonly paths: UserPaths,
  ) {
    for (const row of database.sqlite
      .prepare(
        "SELECT id FROM fcpxml_jobs WHERE json_extract(payload,'$.status') IN ('queued','running')",
      )
      .all() as { id: string }[])
      this.update(row.id, {
        status: 'failed',
        error: 'Export was interrupted. Load the timeline and export again.',
      });
  }
  get(id: string): C.FcpxmlJob {
    const row = this.database.sqlite
      .prepare('SELECT payload FROM fcpxml_jobs WHERE id=?')
      .get(id) as { payload: string } | undefined;
    if (!row) throw new CatalogError('FCPXML export not found');
    return C.FcpxmlJobSchema.parse(JSON.parse(row.payload));
  }
  list(libraryId: string): C.FcpxmlJob[] {
    new CatalogStore(this.database).getLibrary(libraryId);
    return (
      this.database.sqlite
        .prepare(
          'SELECT payload FROM fcpxml_jobs WHERE library_id=? ORDER BY created_at DESC,id',
        )
        .all(libraryId) as { payload: string }[]
    ).map((row) => C.FcpxmlJobSchema.parse(JSON.parse(row.payload)));
  }
  private update(id: string, patch: Partial<C.FcpxmlJob>) {
    const job = C.FcpxmlJobSchema.parse({
      ...this.get(id),
      ...patch,
      updatedAt: now(),
    });
    this.database.sqlite
      .prepare('UPDATE fcpxml_jobs SET payload=?,updated_at=? WHERE id=?')
      .run(JSON.stringify(job), job.updatedAt, id);
    return job;
  }
  private capacity() {
    if (this.closing || this.running.size >= 2)
      throw new CatalogError(
        'Two media operations are running. Wait for one to finish.',
        'FCPXML_BUSY',
        409,
      );
  }
  private async worker(
    data: unknown,
    progress?: (value: number) => void,
  ): Promise<Message> {
    const compiled = new URL('./worker.js', import.meta.url);
    const worker = existsSync(fileURLToPath(compiled))
      ? new Worker(compiled, { workerData: data })
      : new Worker(
          `require('tsx/esm/api').register();import(${JSON.stringify(new URL('./worker.ts', import.meta.url).href)});`,
          { eval: true, workerData: data },
        );
    try {
      return await new Promise<Message>((resolve, reject) => {
        let done = false;
        worker.on('message', (message: Message) => {
          if (message.progress !== undefined) progress?.(message.progress);
          if (message.error || message.bytes !== undefined || message.timing) {
            done = true;
            resolve(message);
          }
        });
        worker.on('error', reject);
        worker.on('exit', () => {
          if (!done) reject(new Error('Media worker stopped'));
        });
      });
    } finally {
      await worker.terminate();
    }
  }
  start(libraryId: string, input: C.CreateFcpxml): C.FcpxmlJob {
    this.capacity();
    const request = C.CreateFcpxmlSchema.parse(input);
    new CatalogStore(this.database).getLibrary(libraryId);
    let snapshot: FcpxmlSnapshot | undefined,
      problems: C.FcpxmlProblem[] = [];
    try {
      snapshot = readFcpxmlSnapshot(this.database, libraryId, request);
    } catch (error) {
      if (!(error instanceof FcpxmlValidationError)) throw error;
      problems = error.problems;
    }
    const id = randomUUID(),
      date = now();
    const job = C.FcpxmlJobSchema.parse({
      id,
      libraryId,
      request,
      status: snapshot ? 'queued' : 'failed',
      progress: 0,
      filename: `${C.versionExportName(request.name, 'timeline.zip')}`,
      duration: snapshot?.manifest.duration ?? null,
      bytes: 0,
      problems,
      error: snapshot
        ? null
        : 'Some clips cannot be exported. Review the per-clip guidance.',
      createdAt: date,
      updatedAt: date,
    });
    this.database.sqlite
      .prepare('INSERT INTO fcpxml_jobs VALUES (?,?,?,NULL,?,?)')
      .run(id, libraryId, JSON.stringify(job), date, date);
    if (snapshot) {
      const operation = this.run(job, snapshot).finally(() =>
        this.running.delete(id),
      );
      this.running.set(id, operation);
    }
    return job;
  }
  private async run(job: C.FcpxmlJob, snapshot: FcpxmlSnapshot) {
    const directory = join(this.paths.data, 'fcpxml'),
      temporary = join(directory, job.id + '.partial'),
      destination = join(directory, job.id);
    try {
      await mkdir(directory, { recursive: true });
      this.update(job.id, { status: 'running', progress: 0.01 });
      const result = await this.worker(
        {
          mode: 'package',
          snapshot,
          temporary,
          destination,
          dataDirectory: this.paths.data,
        },
        (progress) => this.update(job.id, { progress }),
      );
      if (result.error) {
        this.update(job.id, {
          status: 'failed',
          error: result.error,
          problems: result.problems ?? [],
        });
        return;
      }
      if (result.bytes === undefined) throw new Error('Package was incomplete');
      await rename(temporary, destination);
      this.database.sqlite
        .prepare('UPDATE fcpxml_jobs SET package_path=? WHERE id=?')
        .run(destination, job.id);
      this.update(job.id, {
        status: 'completed',
        progress: 1,
        bytes: result.bytes,
      });
    } catch {
      this.update(job.id, {
        status: 'failed',
        error:
          'Export could not complete. Check retained sources, disk space and permissions, then retry.',
      });
    } finally {
      await rm(temporary, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
  async probe(versionId: string): Promise<C.FcpxmlVideoTiming> {
    this.capacity();
    const file = new CatalogStore(this.database).getVersionFile(versionId);
    if (!['video/mp4', 'video/quicktime'].includes(file.type))
      throw new CatalogError(
        'Select an MP4 or MOV video.',
        'SOURCE_UNSUPPORTED',
        400,
      );
    const id = randomUUID(),
      operation = (async () => {
        const root = await realpath(this.paths.data),
          source = await realpath(file.snapshotPath),
          inside = relative(root, source);
        if (inside.startsWith('..') || isAbsolute(inside))
          throw new CatalogError(
            'Retained source is unavailable.',
            'SOURCE_UNAVAILABLE',
            409,
          );
        const result = await this.worker({ mode: 'probe', path: source });
        if (!result.timing)
          throw new CatalogError(
            result.error ?? 'Source timing is unavailable.',
            'SOURCE_UNSUPPORTED',
            422,
          );
        return C.FcpxmlVideoTimingSchema.parse(result.timing);
      })()
        .catch((error) => {
          if (error instanceof CatalogError) throw error;
          throw new CatalogError(
            'Retained source is unavailable. Choose another version.',
            'SOURCE_UNAVAILABLE',
            409,
          );
        })
        .finally(() => this.running.delete(id));
    this.running.set(id, operation);
    return operation;
  }
  file(
    id: string,
    kind: 'xml' | 'package',
  ): { path: string; filename: string } {
    const job = this.get(id);
    if (job.status !== 'completed')
      throw new CatalogError(
        'Export is not complete.',
        'FCPXML_NOT_READY',
        409,
      );
    const row = this.database.sqlite
      .prepare('SELECT package_path FROM fcpxml_jobs WHERE id=?')
      .get(id) as { package_path: string };
    const path = join(
      row.package_path,
      kind === 'xml' ? 'timeline.fcpxml' : 'package.zip',
    );
    if (!existsSync(path))
      throw new CatalogError(
        'Export files are unavailable. Load the timeline and export again.',
        'FCPXML_MISSING',
        410,
      );
    return {
      path,
      filename:
        kind === 'xml'
          ? C.versionExportName(job.request.name, 'timeline.fcpxml')
          : job.filename!,
    };
  }
  async close() {
    this.closing = true;
    await Promise.allSettled(this.running.values());
  }
}
