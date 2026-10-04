import { parentPort } from 'node:worker_threads';
import { lstat, readdir, realpath, unlink } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { savePreview } from './preview-upload.js';
import { processFile } from './image.js';
import { resolveContained } from './path-utils.js';

interface Job {
  id: number;
  kind:
    | 'scan'
    | 'process'
    | 'shutdown'
    | 'cache-info'
    | 'cache-clear'
    | 'preview';
  bytes: Uint8Array;
  root: string;
  relativePath: string;
  dataDir: string;
  cacheDir: string;
}
interface FileFailure {
  message: string;
  code?: string;
}
function failure(error: unknown): FileFailure {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return {
    message: error instanceof Error ? error.message : String(error),
    ...(code ? { code } : {}),
  };
}
const port = parentPort;
if (!port) throw new Error('Media processing must run in a worker.');
let stopping = false;
let active = false;
async function registeredRoot(root: string) {
  const canonical = await realpath(root);
  if (relative(canonical, resolve(root)))
    throw Object.assign(
      new Error('Registered root now resolves outside its original location.'),
      { code: 'ROOT_CHANGED' },
    );
  return canonical;
}
async function scan(
  root: string,
): Promise<{ files: string[]; errors: FileFailure[] }> {
  const canonicalRoot = await registeredRoot(root);
  const files: string[] = [];
  const errors: FileFailure[] = [];
  const pending = [canonicalRoot];
  while (pending.length && !stopping) {
    const directory = pending.pop()!;
    try {
      const safe =
        directory === canonicalRoot
          ? await registeredRoot(root)
          : await resolveContained(
              canonicalRoot,
              relative(canonicalRoot, directory),
            );
      for (const entry of await readdir(safe, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const file = join(safe, entry.name);
        if (entry.isDirectory()) pending.push(file);
        else if (entry.isFile()) files.push(file);
      }
    } catch (error) {
      errors.push(failure(error));
    }
  }
  return { files, errors };
}
async function process(job: Job) {
  const root = await registeredRoot(job.root);
  const filePath = await resolveContained(root, job.relativePath);
  const before = await lstat(filePath, { bigint: true });
  if (!before.isFile())
    throw new Error('Only contained regular files can be imported.');
  const result = await processFile({
    filePath,
    dataDir: job.dataDir,
    cacheDir: job.cacheDir,
  });
  // Revalidate after copying as well: the watched path may change while decoding.
  await registeredRoot(job.root);
  if ((await resolveContained(root, job.relativePath)) !== filePath)
    throw new Error('Source path changed during import.');
  const after = await lstat(filePath, { bigint: true });
  if (
    !after.isFile() ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs
  ) {
    throw Object.assign(
      new Error('File changed during import; retry after the writer finishes.'),
      { code: 'FILE_CHANGED' },
    );
  }
  return result;
}

async function cache(
  cacheDir: string,
  clear: boolean,
): Promise<{ files: number; bytes: number }> {
  let root: string;
  let thumbnails: string;
  try {
    root = await realpath(cacheDir);
    thumbnails = join(root, 'thumbnails');
    const directory = await lstat(thumbnails);
    if (directory.isSymbolicLink() || !directory.isDirectory())
      throw Object.assign(
        new Error('Unsafe cache directory: symbolic links are not allowed.'),
        { code: 'UNSAFE_CACHE' },
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { files: 0, bytes: 0 };
    throw error;
  }
  const pending = [thumbnails];
  const files: { path: string; size: number }[] = [];
  while (pending.length) {
    const directory = pending.pop()!;
    await resolveContained(root, relative(root, directory));
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw Object.assign(
          new Error('Unsafe cache entry: symbolic links are not allowed.'),
          { code: 'UNSAFE_CACHE' },
        );
      const file = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile()) {
        const safe = await resolveContained(
          thumbnails,
          relative(thumbnails, file),
        );
        const info = await lstat(safe);
        if (!info.isFile())
          throw new Error('Cache entry changed while checking it.');
        files.push({ path: safe, size: info.size });
      }
    }
  }
  if (clear)
    for (const file of files) {
      await resolveContained(thumbnails, relative(thumbnails, file.path));
      await unlink(file.path);
    }
  return {
    files: files.length,
    bytes: files.reduce((total, file) => total + file.size, 0),
  };
}
port.on('message', (job: Job) => {
  if (job.kind === 'shutdown') {
    stopping = true;
    if (!active) port.close();
    return;
  }
  if (stopping || active) {
    port.postMessage({
      id: job.id,
      error: {
        message: 'Media worker is busy or stopping.',
        code: 'MEDIA_QUEUE_FULL',
      },
    });
    return;
  }
  active = true;
  void (async () => {
    try {
      port.postMessage({
        id: job.id,
        result:
          job.kind === 'preview'
            ? await savePreview(job.cacheDir, job.bytes)
            : job.kind === 'scan'
              ? await scan(job.root)
              : job.kind === 'cache-info' || job.kind === 'cache-clear'
                ? await cache(job.cacheDir, job.kind === 'cache-clear')
                : await process(job),
      });
    } catch (error) {
      port.postMessage({ id: job.id, error: failure(error) });
    } finally {
      active = false;
      if (stopping) port.close();
    }
  })();
});
