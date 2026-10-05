import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import {
  DatabaseIntegrityDiagnosticsSchema,
  type DatabaseIntegrityDiagnostics,
} from '@cura/shared';

const inFlight = new Map<string, Promise<DatabaseIntegrityDiagnostics>>();
const DEADLINE_MS = 5000;

export function runDatabaseIntegrity(
  databasePath: string,
  options: { workerFile?: URL; timeoutMs?: number } = {},
): Promise<DatabaseIntegrityDiagnostics> {
  const path = resolve(databasePath);
  const existing = inFlight.get(path);
  if (existing) return existing;
  const started = performance.now();
  const checkedAt = new Date().toISOString();
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1, Math.min(DEADLINE_MS, options.timeoutMs!))
    : DEADLINE_MS;
  const remove = () => {
    if (inFlight.get(path) === pending) inFlight.delete(path);
  };
  const pending = new Promise<DatabaseIntegrityDiagnostics>((resolveResult) => {
    let worker: Worker | undefined;
    let settled = false;
    const failure = (timeout = false): DatabaseIntegrityDiagnostics => ({
      status: timeout ? 'timeout' : 'error',
      checkedAt,
      durationMs: 0,
      integrityCheck: 'not-run',
      foreignKeyCheck: 'not-run',
      issues: [],
      truncated: false,
      code: timeout ? 'INTEGRITY_TIMEOUT' : 'INTEGRITY_WORKER_FAILED',
    });
    const finish = (
      result: DatabaseIntegrityDiagnostics,
      waitForExit = false,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!waitForExit) queueMicrotask(remove);
      if (worker) {
        worker.unref();
        // Native SQLite work may delay termination; never delay the response.
        // Retain timed-out work in the map until exit to prevent worker buildup.
        void worker.terminate().then(remove, remove);
      } else {
        queueMicrotask(remove);
      }
      resolveResult({
        ...result,
        checkedAt,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
      });
    };
    const timer = setTimeout(() => finish(failure(true), true), timeoutMs);
    try {
      const compiled = new URL('./integrity-worker.js', import.meta.url);
      if (options.workerFile) {
        worker = new Worker(options.workerFile, {
          workerData: { databasePath: path },
        });
      } else if (existsSync(fileURLToPath(compiled))) {
        worker = new Worker(compiled, { workerData: { databasePath: path } });
      } else {
        const source = new URL('./integrity-worker.ts', import.meta.url).href;
        worker = new Worker(
          `require('tsx/esm/api').tsImport(${JSON.stringify(source)}, ${JSON.stringify(import.meta.url)});`,
          {
            eval: true,
            workerData: { databasePath: path },
          },
        );
      }
      worker.once('message', (message: unknown) => {
        const parsed = DatabaseIntegrityDiagnosticsSchema.safeParse(message);
        finish(parsed.success ? parsed.data : failure(), !parsed.success);
      });
      worker.once('error', () => finish(failure(), true));
      worker.once('exit', () => {
        finish(failure());
        remove();
      });
    } catch {
      finish(failure());
    }
  });
  inFlight.set(path, pending);
  return pending;
}
