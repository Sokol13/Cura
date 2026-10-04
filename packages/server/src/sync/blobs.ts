import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { SupabaseClient } from '@supabase/supabase-js';
import { IdSchema } from '@cura/shared';
import type { UserPaths } from '../paths.js';
import { SyncError } from './errors.js';

const BUCKET = 'cura-sync-objects';
/** Keep requests bounded without buffering files in memory. */
const MAX_BYTES = 512 * 1024 * 1024;
type BlobFile = { hash: string; size: number; type: string };

function invalid(): SyncError {
  return new SyncError(
    'Cloud object metadata is invalid.',
    'SYNC_BLOB_INVALID',
    400,
  );
}
function integrity(): SyncError {
  return new SyncError(
    'Cloud object bytes do not match their expected size and SHA-256.',
    'SYNC_BLOB_INTEGRITY',
    409,
  );
}
function cancelled(): SyncError {
  return new SyncError(
    'Cloud object transfer was cancelled.',
    'SYNC_CANCELLED',
    499,
  );
}
function validate(hash: string, size: number): void {
  if (!/^[a-f0-9]{64}$/.test(hash) || !Number.isSafeInteger(size) || size < 0)
    throw invalid();
  if (size > MAX_BYTES)
    throw new SyncError(
      'Cloud sync supports objects up to 512 MiB.',
      'SYNC_BLOB_LIMIT',
      413,
    );
}
function objectName(libraryId: string, file: BlobFile): string {
  validate(file.hash, file.size);
  if (
    !IdSchema.safeParse(libraryId).success ||
    libraryId !== libraryId.toLowerCase() ||
    !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(file.type) ||
    file.type.length > 255
  )
    throw invalid();
  return `${libraryId}/${file.hash}`;
}
function abort(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelled();
}
function publicError(error: unknown, signal?: AbortSignal): SyncError {
  if (signal?.aborted) return cancelled();
  if (error instanceof SyncError) return error;
  const code =
    error && typeof error === 'object' && 'code' in error
      ? error.code
      : undefined;
  if (
    typeof code === 'string' &&
    ['ENOSPC', 'EIO', 'EACCES', 'EPERM', 'EROFS', 'ENOENT'].includes(code)
  ) {
    return new SyncError(
      'Local object storage could not be read or written.',
      'SYNC_BLOB_IO',
      500,
    );
  }
  return new SyncError(
    'Cloud object transfer failed. Retry when the connection is available.',
    'SYNC_BLOB_TRANSFER',
    502,
  );
}
function verification(hash: string, size: number): Transform {
  const digest = createHash('sha256');
  let length = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      length += chunk.length;
      if (length > size) return callback(integrity());
      digest.update(chunk);
      callback(null, chunk);
    },
    flush(callback) {
      if (length !== size || digest.digest('hex') !== hash)
        callback(integrity());
      else callback();
    },
  });
}

/** Stream verification rejects excess/truncated bytes before accepting a file. */
export async function verifyFile(
  path: string,
  hash: string,
  size: number,
  signal?: AbortSignal,
): Promise<void> {
  validate(hash, size);
  abort(signal);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== size)
      throw integrity();
    const digest = createHash('sha256');
    let length = 0;
    for await (const value of createReadStream(path, { signal })) {
      const chunk = value as Buffer;
      abort(signal);
      length += chunk.length;
      if (length > size) throw integrity();
      digest.update(chunk);
    }
    if (length !== size || digest.digest('hex') !== hash) throw integrity();
  } catch (error) {
    if (signal?.aborted) throw cancelled();
    if (error instanceof SyncError) throw error;
    const code =
      error && typeof error === 'object' && 'code' in error
        ? error.code
        : undefined;
    throw new SyncError(
      code === 'ENOENT'
        ? 'Retained object bytes are unavailable.'
        : 'Retained object bytes could not be read.',
      code === 'ENOENT' ? 'SYNC_BLOB_MISSING' : 'SYNC_BLOB_IO',
      code === 'ENOENT' ? 404 : 500,
    );
  }
}

async function remoteStream(
  client: SupabaseClient,
  name: string,
  signal: AbortSignal,
) {
  abort(signal);
  const { data, error } = await client.storage
    .from(BUCKET)
    .download(name, {}, { signal })
    .asStream();
  if (error || !data)
    throw new SyncError(
      'Cloud object bytes are unavailable or access was denied.',
      'SYNC_BLOB_TRANSFER',
      502,
    );
  return data as ReadableStream<Uint8Array>;
}

async function readVerified(
  stream: ReadableStream<Uint8Array>,
  file: BlobFile,
  signal: AbortSignal,
  write?: (chunk: Uint8Array) => Promise<void>,
): Promise<void> {
  const reader = stream.getReader();
  const digest = createHash('sha256');
  let length = 0;
  try {
    for (;;) {
      abort(signal);
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > file.size) throw integrity();
      digest.update(value);
      if (write) await write(value);
    }
    abort(signal);
    if (length !== file.size || digest.digest('hex') !== file.hash)
      throw integrity();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Uploads immutable retained bytes; existing objects must pass a full download
 * verification before a retry counts as successful. */
export async function ensureRemoteObject(
  client: SupabaseClient,
  libraryId: string,
  file: BlobFile & { source: string },
  signal?: AbortSignal,
): Promise<void> {
  const name = objectName(libraryId, file);
  abort(signal);
  const deadline = AbortSignal.timeout(120_000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  await verifyFile(file.source, file.hash, file.size, combined);
  const source = createReadStream(file.source, { signal: combined });
  const verified = verification(file.hash, file.size);
  const copied = pipeline(source, verified, { signal: combined });
  void copied.catch(() => {});
  // Upload's SDK API has no signal option; destroying its Node request stream
  // aborts the body. Also stop awaiting an already-sent body on cancellation.
  const onAbort = () => verified.destroy(cancelled());
  combined.addEventListener('abort', onAbort, { once: true });
  let removeAbort: (() => void) | undefined;
  try {
    const uploading = client.storage.from(BUCKET).upload(name, verified, {
      upsert: false,
      contentType: file.type,
      duplex: 'half',
    });
    const interrupted = new Promise<never>((_resolve, reject) => {
      const stop = () => reject(cancelled());
      combined.addEventListener('abort', stop, { once: true });
      removeAbort = () => combined.removeEventListener('abort', stop);
    });
    const result = await Promise.race([uploading, interrupted]);
    if (!result.error) {
      await copied;
      return;
    }
    // A rejected upload may stop reading its request early. Do not leave a
    // blocked stream or an unhandled pipeline rejection behind.
    source.destroy();
    verified.destroy();
    await copied.catch(() => {});
    const status =
      'statusCode' in result.error ? String(result.error.statusCode) : '';
    if (
      status !== '409' &&
      result.error.message !== 'The resource already exists'
    ) {
      throw new SyncError(
        'Cloud object upload failed or access was denied.',
        'SYNC_BLOB_TRANSFER',
        502,
      );
    }
    await readVerified(
      await remoteStream(client, name, combined),
      file,
      combined,
    );
  } catch (error) {
    throw publicError(error, combined);
  } finally {
    removeAbort?.();
    combined.removeEventListener('abort', onAbort);
    source.destroy();
    verified.destroy();
    await copied.catch(() => {});
  }
}

/** Materializes verified bytes in the same flat object store used by ingestion. */
export async function materializeObject(
  client: SupabaseClient,
  paths: UserPaths,
  libraryId: string,
  file: BlobFile,
  signal?: AbortSignal,
): Promise<string> {
  const name = objectName(libraryId, file);
  abort(signal);
  const directory = join(paths.data, 'objects');
  const destination = join(directory, file.hash);
  const temporary = join(directory, `.${file.hash}-${randomUUID()}.part`);
  const deadline = AbortSignal.timeout(120_000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new SyncError(
        'Object storage is unavailable.',
        'SYNC_BLOB_IO',
        500,
      );
    try {
      await verifyFile(destination, file.hash, file.size, combined);
      return destination;
    } catch (error) {
      if (
        !(error instanceof SyncError) ||
        !['SYNC_BLOB_MISSING', 'SYNC_BLOB_INTEGRITY'].includes(error.code)
      )
        throw error;
    }
    const handle = await open(temporary, 'wx', 0o600);
    try {
      const stream = await remoteStream(client, name, combined);
      await readVerified(stream, file, combined, async (chunk) => {
        await handle.writeFile(chunk);
      });
      await handle.sync();
    } finally {
      await handle.close();
    }
    abort(combined);
    await rename(temporary, destination);
    return destination;
  } catch (error) {
    throw publicError(error, combined);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}
