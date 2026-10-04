import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { UserPaths } from '../paths.js';
import type { PortableGraph } from './portable.js';
import { SyncError } from './errors.js';
export async function snapshotGraph(
  paths: UserPaths,
  libraryId: string,
  signal?: AbortSignal,
): Promise<{ graph: PortableGraph; semanticHash: string }> {
  if (signal?.aborted)
    throw new SyncError('Sync was cancelled', 'SYNC_CANCELLED', 499);
  const compiled = new URL('./snapshot-worker.js', import.meta.url),
    workerData = { databasePath: join(paths.data, 'cura.sqlite'), libraryId };
  const worker = existsSync(fileURLToPath(compiled))
    ? new Worker(compiled, {
        workerData,
        resourceLimits: {
          maxOldGenerationSizeMb: 256,
          maxYoungGenerationSizeMb: 32,
        },
      })
    : new Worker(
        new URL(
          `data:text/javascript,${encodeURIComponent(`import { register } from ${JSON.stringify(pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm/api')).href)}; register(); await import(${JSON.stringify(new URL('./snapshot-worker.ts', import.meta.url).href)});`)}`,
        ),
        {
          workerData,
          resourceLimits: {
            maxOldGenerationSizeMb: 256,
            maxYoungGenerationSizeMb: 32,
          },
        },
      );
  let onAbort: () => void = () => {};
  try {
    return await new Promise((resolve, reject) => {
      onAbort = () => {
        void worker.terminate();
        reject(new SyncError('Sync was cancelled', 'SYNC_CANCELLED', 499));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.once(
        'message',
        (value: {
          graph?: PortableGraph;
          semanticHash?: string;
          error?: string;
        }) => {
          if (value.graph && value.semanticHash)
            resolve({ graph: value.graph, semanticHash: value.semanticHash });
          else
            reject(
              new SyncError(
                'Library metadata could not be read consistently',
                'SYNC_SNAPSHOT',
                500,
              ),
            );
        },
      );
      worker.once('error', () =>
        reject(
          new SyncError('Library metadata worker failed', 'SYNC_SNAPSHOT', 500),
        ),
      );
      worker.once('exit', (code) => {
        if (code !== 0)
          reject(
            new SyncError(
              'Library metadata worker stopped',
              'SYNC_SNAPSHOT',
              500,
            ),
          );
      });
    });
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await worker.terminate();
  }
}
