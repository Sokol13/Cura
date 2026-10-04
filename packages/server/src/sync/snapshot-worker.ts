import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema.js';
import { readPortableGraph, semanticHash } from './portable.js';
const data = workerData as { databasePath: string; libraryId: string };
const sqlite = new Database(data.databasePath, {
  readonly: true,
  fileMustExist: true,
});
try {
  const graph = readPortableGraph(
    {
      sqlite,
      database: drizzle(sqlite, { schema }),
      close: () => sqlite.close(),
    },
    data.libraryId,
  );
  parentPort?.postMessage({ graph, semanticHash: semanticHash(graph.records) });
} catch {
  parentPort?.postMessage({
    error: 'Library metadata could not be read consistently',
  });
} finally {
  sqlite.close();
}
