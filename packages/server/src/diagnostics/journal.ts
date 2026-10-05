import { readFileSync, statSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DIAGNOSTIC_MESSAGES,
  DiagnosticLogSchema,
  DiagnosticOperationSchema,
  IdSchema,
  type DiagnosticCapture,
  type DiagnosticLog,
  type DiagnosticLogsSnapshot,
} from '@cura/shared';

const codes = new Set([
  'UNCLASSIFIED_WARNING',
  'INTERNAL_ERROR',
  'VALIDATION',
  'SYNC_INITIALIZATION',
  'EPERM',
  'EACCES',
  'ENOENT',
  'ENOTDIR',
  'EIO',
  'EMFILE',
  'ENFILE',
  'ELOOP',
  'ENAMETOOLONG',
  'EBUSY',
  'ENOSPC',
  'EBADF',
  'ENOMEM',
  'ESTALE',
  'ETIMEDOUT',
  'EINVAL',
  'SQLITE_BUSY',
  'SQLITE_LOCKED',
  'SQLITE_CORRUPT',
  'SQLITE_NOTADB',
  'SQLITE_READONLY',
  'SQLITE_FULL',
  'SQLITE_IOERR',
  'SQLITE_CONSTRAINT_FOREIGNKEY',
  'MEDIA_OPERATION_FAILED',
  'MEDIA_WORKER_FAILED',
  'MEDIA_FAILURE',
  'SCAN_PARTIAL',
  'SCAN_FAILED',
  'SCAN_INTERRUPTED',
  'SCAN_RECOVERED_INTERRUPTED',
  'METADATA_PARSE_WARNINGS',
  'EXIF_PARSE_FAILED',
  'EXIF_SIZE_LIMIT',
  'PSD_NATIVE_PREVIEW_UNAVAILABLE',
  'NATIVE_THUMBNAIL_FAILED',
  'THUMBNAIL_SIZE_LIMIT',
  'PSD_PREVIEW_RECOVERY',
  'ROOT_CHANGED',
  'SOURCE_UNAVAILABLE',
  'FILE_CHANGED',
  'UNSAFE_CACHE',
  'MEDIA_QUEUE_FULL',
  'MEDIA_CLOSED',
  'ROOT_REMOVING',
  'SCAN_SAVE_FAILED',
  'SIZE_LIMIT',
  'PIXEL_LIMIT',
  'MODEL_LIMIT',
  'EXTERNAL_RESOURCE',
  'UNSUPPORTED_FORMAT',
  'VIDEO_CODEC',
  'WEBGL_UNAVAILABLE',
  'PDF_PASSWORD',
  'INVALID_FILE',
  'TIMEOUT',
  'RENDER_FAILED',
]);

function safeRecord(input: unknown): DiagnosticLog | undefined {
  if (!input || typeof input !== 'object') return;
  const row = input as Record<string, unknown>;
  if (row.level !== 40 && row.level !== 50 && row.level !== 60) return;
  const parsedOperation = DiagnosticOperationSchema.safeParse(row.operation);
  const operation = parsedOperation.success ? parsedOperation.data : 'other';
  const identifiers: Partial<
    Record<'rootId' | 'assetId' | 'versionId' | 'libraryId', string>
  > = {};
  for (const key of ['rootId', 'assetId', 'versionId', 'libraryId'] as const) {
    const id = IdSchema.safeParse(row[key]);
    if (id.success) identifiers[key] = id.data;
  }
  return DiagnosticLogSchema.parse({
    level: row.level,
    time:
      typeof row.time === 'number' &&
      Number.isSafeInteger(row.time) &&
      row.time >= 0
        ? row.time
        : Date.now(),
    operation,
    code:
      typeof row.code === 'string' && codes.has(row.code)
        ? row.code
        : 'UNCLASSIFIED_WARNING',
    ...identifiers,
    ...(typeof row.count === 'number' &&
    Number.isSafeInteger(row.count) &&
    row.count >= 0
      ? { count: row.count }
      : {}),
    msg: DIAGNOSTIC_MESSAGES[operation],
  });
}

/** A bounded warning journal independent of the database and noisy HTTP logs. */
export class WarningJournal {
  private readonly file: string;
  private readonly temporary: string;
  private entries: DiagnosticLog[] = [];
  private revision = 0;
  private savedRevision = 0;
  private pending: Promise<void> | undefined;
  private readFailed = false;
  private writeFailed = false;
  private closed = false;

  constructor(private readonly directory: string) {
    this.file = join(directory, 'diagnostic-warnings.json');
    this.temporary = `${this.file}.tmp`;
    try {
      if (statSync(this.file).size > 512 * 1024)
        throw new Error('Oversized journal');
      const payload: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      if (
        !payload ||
        typeof payload !== 'object' ||
        !('version' in payload) ||
        payload.version !== 1 ||
        !('entries' in payload) ||
        !Array.isArray(payload.entries) ||
        payload.entries.length > 200
      )
        throw new Error('Invalid journal');
      this.entries = payload.entries.map((value: unknown) => {
        const validated = DiagnosticLogSchema.parse(value);
        return safeRecord(validated)!;
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.readFailed = true;
    }
  }

  record(input: unknown): void {
    if (this.closed) return;
    const record = safeRecord(input);
    if (!record) return;
    this.entries.push(record);
    if (this.entries.length > 200) this.entries.shift();
    this.revision++;
    this.schedule();
  }

  private schedule(): void {
    if (this.pending || this.revision === this.savedRevision) return;
    const pending = this.persist().finally(() => {
      if (this.pending === pending) this.pending = undefined;
      if (!this.writeFailed && this.revision !== this.savedRevision)
        this.schedule();
    });
    this.pending = pending;
  }

  private async persist(): Promise<void> {
    while (this.revision !== this.savedRevision) {
      const revision = this.revision;
      const bytes = JSON.stringify({ version: 1, entries: this.entries });
      try {
        await mkdir(this.directory, { recursive: true });
        await writeFile(this.temporary, bytes, { mode: 0o600 });
        await rename(this.temporary, this.file);
        this.savedRevision = revision;
        this.writeFailed = false;
      } catch {
        this.writeFailed = true;
        await rm(this.temporary, { force: true }).catch(() => undefined);
        return;
      }
    }
  }

  async snapshot(): Promise<DiagnosticLogsSnapshot> {
    this.schedule();
    while (this.pending) {
      await this.pending;
      if (this.writeFailed) break;
    }
    const failed = this.writeFailed || this.readFailed;
    const capture: DiagnosticCapture = failed
      ? {
          status: this.entries.length ? 'partial' : 'unavailable',
          code: this.writeFailed
            ? 'LOG_JOURNAL_WRITE_FAILED'
            : 'LOG_JOURNAL_READ_FAILED',
        }
      : { status: 'ok' };
    return { entries: structuredClone(this.entries), capture };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await this.snapshot();
    this.closed = true;
  }
}
