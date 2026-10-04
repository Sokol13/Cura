import { parentPort, workerData } from 'node:worker_threads';
import { writeFcpxmlPackage } from './package.js';
import { probeVideo } from './probe.js';
import { FcpxmlValidationError, type FcpxmlSnapshot } from './snapshot.js';
const data = workerData as
  | {
      mode: 'package';
      snapshot: FcpxmlSnapshot;
      temporary: string;
      destination: string;
      dataDirectory: string;
    }
  | { mode: 'probe'; path: string };
async function run() {
  try {
    if (data.mode === 'probe')
      parentPort!.postMessage({ timing: await probeVideo(data.path) });
    else
      parentPort!.postMessage({
        bytes: await writeFcpxmlPackage(
          data.snapshot,
          data.temporary,
          data.destination,
          data.dataDirectory,
          (progress) => parentPort!.postMessage({ progress }),
        ),
      });
  } catch (error) {
    parentPort!.postMessage({
      error:
        error instanceof FcpxmlValidationError
          ? error.message
          : data.mode === 'probe' &&
              error instanceof Error &&
              !('code' in error)
            ? error.message
            : 'Export could not complete. Check retained source files, disk space and permissions, then retry.',
      problems: error instanceof FcpxmlValidationError ? error.problems : [],
    });
  }
}
void run();
