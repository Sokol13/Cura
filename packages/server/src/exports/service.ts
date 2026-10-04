import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import * as C from '@cura/shared';
import type { AppDatabase } from '../database.js';
import type { UserPaths } from '../paths.js';
import { CatalogError } from '../catalog-store.js';
import { readExportSnapshot, type ExportSnapshot } from './snapshot.js';
const now = () => new Date().toISOString();
export class ExportService {
  private readonly running = new Map<string, Promise<void>>();
  private closing = false;
  constructor(
    private readonly database: AppDatabase,
    private readonly paths: UserPaths,
  ) {
    for (const row of database.sqlite
      .prepare(
        "SELECT id FROM export_jobs WHERE json_extract(payload,'$.status') IN ('queued','running')",
      )
      .all() as { id: string }[])
      this.update(row.id, {
        status: 'failed',
        error: 'Export was interrupted. Start a new export to retry.',
      });
  }
  get(id: string): C.ExportJob {
    const row = this.database.sqlite
      .prepare('SELECT payload FROM export_jobs WHERE id=?')
      .get(id) as { payload: string } | undefined;
    if (!row) throw new CatalogError('Export job not found');
    return C.ExportJobSchema.parse(JSON.parse(row.payload));
  }
  list(libraryId: string): C.ExportJob[] {
    if (
      !this.database.sqlite
        .prepare('SELECT id FROM libraries WHERE id=?')
        .get(libraryId)
    )
      throw new CatalogError('Library not found');
    return (
      this.database.sqlite
        .prepare(
          'SELECT payload FROM export_jobs WHERE library_id=? ORDER BY created_at DESC,id',
        )
        .all(libraryId) as { payload: string }[]
    ).map((row) => C.ExportJobSchema.parse(JSON.parse(row.payload)));
  }
  private update(id: string, patch: Partial<C.ExportJob>) {
    const job = C.ExportJobSchema.parse({
      ...this.get(id),
      ...patch,
      updatedAt: now(),
    });
    this.database.sqlite
      .prepare('UPDATE export_jobs SET payload=?,updated_at=? WHERE id=?')
      .run(JSON.stringify(job), job.updatedAt, id);
    return job;
  }
  start(libraryId: string, input: C.ExportRequest): C.ExportJob {
    if (this.closing || this.running.size >= 2)
      throw new CatalogError(
        'Two exports are already running; wait for one to finish.',
        'EXPORT_BUSY',
        409,
      );
    const request = C.ExportRequestSchema.parse(input),
      snapshot = readExportSnapshot(this.database, libraryId, request),
      id = randomUUID(),
      date = now();
    const job = C.ExportJobSchema.parse({
      id,
      libraryId,
      status: 'queued',
      progress: 0,
      request,
      filename: `${snapshot.folder}-${id.slice(0, 8)}.zip`,
      bytes: 0,
      exceptions: [],
      error: null,
      createdAt: date,
      updatedAt: date,
    });
    this.database.sqlite
      .prepare('INSERT INTO export_jobs VALUES (?,?,?,NULL,?,?)')
      .run(id, libraryId, JSON.stringify(job), date, date);
    const operation = this.run(job, snapshot).finally(() =>
      this.running.delete(id),
    );
    this.running.set(id, operation);
    return job;
  }
  private async run(job: C.ExportJob, snapshot: ExportSnapshot): Promise<void> {
    const directory = join(this.paths.data, 'exports');
    const temporary = join(directory, `${job.id}.partial`),
      destination = join(directory, `${job.id}.zip`);
    try {
      mkdirSync(directory, { recursive: true });
      this.update(job.id, { status: 'running', progress: 0.01 });
      const compiled = new URL('./worker.js', import.meta.url),
        workerData = {
          snapshot,
          destination: temporary,
          dataDirectory: this.paths.data,
        };
      const worker = existsSync(fileURLToPath(compiled))
        ? new Worker(compiled, { workerData })
        : new Worker(
            `require('tsx/cjs'); require(${JSON.stringify(fileURLToPath(new URL('./worker.ts', import.meta.url)))});`,
            { eval: true, workerData },
          );
      let exceptions: C.ExportException[] = [];
      try {
        const bytes = await new Promise<number>((resolve, reject) => {
          let done = false;
          worker.on(
            'message',
            (message: {
              progress?: number;
              bytes?: number;
              error?: string;
              exceptions?: C.ExportException[];
            }) => {
              if (message.progress !== undefined)
                this.update(job.id, { progress: message.progress });
              if (message.error) {
                done = true;
                exceptions = message.exceptions ?? [];
                reject(new Error(message.error));
              }
              if (message.bytes !== undefined) {
                done = true;
                resolve(message.bytes);
              }
            },
          );
          worker.on('error', reject);
          worker.on('exit', (code) => {
            if (!done) reject(new Error(`Export worker stopped (${code}).`));
          });
        });
        await rename(temporary, destination);
        this.database.sqlite
          .prepare('UPDATE export_jobs SET archive_path=? WHERE id=?')
          .run(destination, job.id);
        this.update(job.id, { status: 'completed', progress: 1, bytes });
      } catch (error) {
        this.update(job.id, {
          status: 'failed',
          exceptions,
          error: error instanceof Error ? error.message : 'Export failed',
        });
      } finally {
        await worker.terminate();
      }
    } catch {
      this.update(job.id, {
        status: 'failed',
        error:
          'Export could not start. Check local disk space and permissions, then retry.',
      });
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
  archive(id: string): { path: string; filename: string } {
    const job = this.get(id);
    if (job.status !== 'completed' || !job.filename)
      throw new CatalogError('Export is not complete', 'EXPORT_NOT_READY', 409);
    const row = this.database.sqlite
      .prepare('SELECT archive_path FROM export_jobs WHERE id=?')
      .get(id) as { archive_path: string };
    if (!row.archive_path || !existsSync(row.archive_path))
      throw new CatalogError(
        'Export archive is no longer available; create it again',
        'EXPORT_MISSING',
        410,
      );
    return { path: row.archive_path, filename: job.filename };
  }
  async close(): Promise<void> {
    this.closing = true;
    await Promise.allSettled(this.running.values());
  }
}
