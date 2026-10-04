import { parentPort, workerData } from 'node:worker_threads';
import { writeArchive, SnapshotError, ArchiveLimitError } from './archive.js';
import type { ExportSnapshot } from './snapshot.js';
const data = workerData as {
  snapshot: ExportSnapshot;
  destination: string;
  dataDirectory: string;
};
void writeArchive(
  data.snapshot,
  data.destination,
  data.dataDirectory,
  (progress) => parentPort?.postMessage({ progress }),
)
  .then((bytes) => parentPort?.postMessage({ bytes }))
  .catch((error: unknown) =>
    parentPort?.postMessage({
      error:
        error instanceof SnapshotError || error instanceof ArchiveLimitError
          ? error.message
          : 'Export could not be written. Check local disk space and permissions, then retry.',
      exceptions:
        error instanceof SnapshotError
          ? error.exceptions
          : error instanceof ArchiveLimitError
            ? [{ code: 'EXPORT_TOO_LARGE', message: error.message }]
            : [],
    }),
  );
