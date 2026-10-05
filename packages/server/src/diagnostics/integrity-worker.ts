import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';
import {
  DiagnosticTableSchema,
  type DatabaseIntegrityDiagnostics,
} from '@cura/shared';

const ISSUE_LIMIT = 20;
type IntegrityIssue = DatabaseIntegrityDiagnostics['issues'][number];

function checkDatabase(databasePath: string): DatabaseIntegrityDiagnostics {
  const started = performance.now();
  const result: DatabaseIntegrityDiagnostics = {
    status: 'ok',
    checkedAt: new Date().toISOString(),
    durationMs: 0,
    integrityCheck: 'not-run',
    foreignKeyCheck: 'not-run',
    issues: [],
    truncated: false,
  };
  const addIssue = (issue: IntegrityIssue) => {
    if (result.issues.length < ISSUE_LIMIT) {
      result.issues.push(issue);
      return true;
    }
    result.truncated = true;
    return false;
  };
  let database: Database.Database;
  try {
    database = new Database(databasePath, {
      readonly: true,
      fileMustExist: true,
    });
  } catch {
    return { ...result, status: 'error', code: 'SQLITE_OPEN_FAILED' };
  }
  try {
    database.transaction(() => {
      try {
        result.integrityCheck = 'ok';
        let violations = 0;
        for (const row of database
          .prepare('PRAGMA integrity_check(20)')
          .iterate()) {
          if ((row as { integrity_check: unknown }).integrity_check === 'ok')
            continue;
          result.integrityCheck = 'issues';
          violations++;
          addIssue({ code: 'INTEGRITY_VIOLATION' });
        }
        // SQLite stops at this limit, so more violations may remain unreported.
        if (violations === ISSUE_LIMIT) result.truncated = true;
      } catch {
        result.integrityCheck = 'error';
        addIssue({ code: 'CHECK_FAILED' });
      }
      try {
        result.foreignKeyCheck = 'ok';
        for (const row of database
          .prepare('PRAGMA foreign_key_check')
          .iterate()) {
          result.foreignKeyCheck = 'issues';
          const location = row as {
            table: unknown;
            parent: unknown;
            rowid: unknown;
            fkid: unknown;
          };
          const table = DiagnosticTableSchema.safeParse(location.table);
          const parent = DiagnosticTableSchema.safeParse(location.parent);
          const issue: IntegrityIssue = { code: 'FOREIGN_KEY_VIOLATION' };
          if (table.success) issue.table = table.data;
          if (parent.success) issue.parent = parent.data;
          if (
            location.rowid === null ||
            (typeof location.rowid === 'number' &&
              Number.isSafeInteger(location.rowid))
          ) {
            issue.rowid = location.rowid;
          }
          if (
            typeof location.fkid === 'number' &&
            Number.isSafeInteger(location.fkid) &&
            location.fkid >= 0
          ) {
            issue.foreignKeyId = location.fkid;
          }
          if (!addIssue(issue)) break;
        }
      } catch {
        result.foreignKeyCheck = 'error';
        addIssue({ code: 'CHECK_FAILED' });
      }
    })();
    if (
      result.integrityCheck === 'error' ||
      result.foreignKeyCheck === 'error'
    ) {
      result.status = 'error';
      result.code = 'SQLITE_CHECK_FAILED';
    } else if (result.issues.length) {
      result.status = 'issues';
    }
  } catch {
    result.status = 'error';
    result.code = 'SQLITE_CHECK_FAILED';
    addIssue({ code: 'CHECK_FAILED' });
  } finally {
    database.close();
    result.durationMs = Math.max(0, Math.round(performance.now() - started));
  }
  return result;
}

const { databasePath } = workerData as { databasePath: string };
parentPort?.postMessage(checkDatabase(databasePath));
