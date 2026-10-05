import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  LibraryRootSchema,
  ScanSummarySchema,
  TimestampSchema,
  type LibraryRoot,
  type ScanSummary,
} from '@cura/shared';
import type { AppDatabase } from '../database.js';

type SummaryRow = { payload: string };

/** Local operational history: never part of a portable library graph. */
export class ScanStore {
  private readonly sqlite: Database.Database;

  constructor(database: AppDatabase) {
    this.sqlite = database.sqlite;
  }

  start(root: LibraryRoot, startedAt = new Date().toISOString()): ScanSummary {
    const identity = LibraryRootSchema.parse(root);
    const date = TimestampSchema.parse(startedAt);
    return this.sqlite.transaction(() => {
      if (
        !this.sqlite
          .prepare(
            'SELECT 1 FROM library_roots WHERE id=? AND library_id=? AND removed_at IS NULL AND managed=0',
          )
          .get(identity.id, identity.libraryId)
      ) {
        throw Object.assign(
          new Error('Root is not registered for local files'),
          {
            code: 'NOT_FOUND',
            statusCode: 404,
          },
        );
      }
      const summary = ScanSummarySchema.parse({
        scanId: randomUUID(),
        rootId: identity.id,
        libraryId: identity.libraryId,
        status: 'running',
        phase: 'enumerating',
        recursive: true,
        startedAt: date,
        finishedAt: null,
        createdAt: date,
        updatedAt: date,
        filesFound: 0,
        supportedFound: 0,
        existingGenericFound: 0,
        unsupportedSkipped: 0,
        processed: 0,
        succeeded: 0,
        readErrors: 0,
        symlinksSkipped: 0,
        specialEntriesSkipped: 0,
        extensions: [],
        otherExtensionFiles: 0,
        errors: [],
        omittedErrors: 0,
      });
      this.sqlite
        .prepare(
          `INSERT INTO root_scan_summaries(root_id,library_id,scan_id,payload,created_at,updated_at)
        VALUES (?,?,?,?,?,?) ON CONFLICT(root_id) DO UPDATE SET
        library_id=excluded.library_id,scan_id=excluded.scan_id,payload=excluded.payload,
        created_at=excluded.created_at,updated_at=excluded.updated_at`,
        )
        .run(
          summary.rootId,
          summary.libraryId,
          summary.scanId,
          JSON.stringify(summary),
          date,
          date,
        );
      return summary;
    })();
  }

  save(input: ScanSummary): boolean {
    const summary = ScanSummarySchema.parse(input);
    // Late progress cannot revive an interrupted/completed scan. Timestamps and
    // immutable run identity also stop old writes within the same scan.
    const result = this.sqlite
      .prepare(
        `UPDATE root_scan_summaries SET payload=?,updated_at=?
      WHERE root_id=? AND library_id=? AND scan_id=? AND created_at=?
      AND json_extract(payload,'$.startedAt')=?
      AND json_extract(payload,'$.status')='running'
      AND julianday(updated_at)<=julianday(?)`,
      )
      .run(
        JSON.stringify(summary),
        summary.updatedAt,
        summary.rootId,
        summary.libraryId,
        summary.scanId,
        summary.createdAt,
        summary.startedAt,
        summary.updatedAt,
      );
    return result.changes === 1;
  }

  get(rootId: string): ScanSummary | undefined {
    const row = this.sqlite
      .prepare('SELECT payload FROM root_scan_summaries WHERE root_id=?')
      .get(rootId) as SummaryRow | undefined;
    return row ? ScanSummarySchema.parse(JSON.parse(row.payload)) : undefined;
  }

  list(libraryId?: string, includeRemoved = false): ScanSummary[] {
    const conditions = ['r.managed=0'];
    const values: string[] = [];
    if (!includeRemoved) conditions.push('r.removed_at IS NULL');
    if (libraryId !== undefined) {
      conditions.push('s.library_id=?');
      values.push(libraryId);
    }
    const rows = this.sqlite
      .prepare(
        `SELECT s.payload FROM root_scan_summaries s
      JOIN library_roots r ON r.id=s.root_id AND r.library_id=s.library_id
      WHERE ${conditions.join(' AND ')} ORDER BY s.updated_at DESC,s.root_id`,
      )
      .all(...values) as SummaryRow[];
    return rows.map((row) => ScanSummarySchema.parse(JSON.parse(row.payload)));
  }

  interruptRunning(): ScanSummary[] {
    return this.sqlite.transaction(() => {
      const rows = this.sqlite
        .prepare(
          "SELECT payload FROM root_scan_summaries WHERE json_extract(payload,'$.status')='running' ORDER BY root_id",
        )
        .all() as SummaryRow[];
      return rows.map((row) => {
        const current = ScanSummarySchema.parse(JSON.parse(row.payload));
        const date = new Date(
          Math.max(Date.now(), Date.parse(current.updatedAt)),
        ).toISOString();
        const interrupted: ScanSummary = {
          ...current,
          status: 'interrupted',
          phase: 'finished',
          finishedAt: date,
          updatedAt: date,
        };
        this.save(interrupted);
        return interrupted;
      });
    })();
  }
}
