import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AutomationError } from './errors.js';
export function runAutomationWorker<T>(
  payload: object,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const compiled = new URL('./worker.js', import.meta.url);
    const worker = existsSync(fileURLToPath(compiled))
      ? new Worker(compiled, { workerData: payload })
      : new Worker(
          `require('tsx/cjs');require(${JSON.stringify(fileURLToPath(new URL('./worker.ts', import.meta.url)))});`,
          { eval: true, workerData: payload },
        );
    let settled = false;
    const finish = (error?: Error, result?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      void worker
        .terminate()
        .finally(() => (error ? reject(error) : resolve(result!)));
    };
    const abort = () => finish(new AutomationError('CANCELLED', 409));
    const timer = setTimeout(
      () => finish(new AutomationError('WORKER_TIMEOUT', 504)),
      15000,
    );
    signal.addEventListener('abort', abort, { once: true });
    worker.once('message', (message: { result?: T; error?: string }) =>
      finish(
        message.error ? new AutomationError(message.error) : undefined,
        message.result,
      ),
    );
    worker.once('error', () =>
      finish(new AutomationError('WORKER_FAILED', 500)),
    );
    worker.once('exit', () => {
      if (!settled) finish(new AutomationError('WORKER_FAILED', 500));
    });
  });
}
