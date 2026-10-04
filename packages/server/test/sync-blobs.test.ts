import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureRemoteObject,
  materializeObject,
  verifyFile,
} from '../src/sync/blobs.js';
import type { UserPaths } from '../src/paths.js';

const libraryId = randomUUID();
const bytes = Buffer.from('Retained immutable fixture bytes');
const hash = createHash('sha256').update(bytes).digest('hex');
const file = { hash, size: bytes.length, type: 'application/octet-stream' };

describe('verified streaming sync objects', () => {
  let directory: string;
  let source: string;
  let paths: UserPaths;
  let server: Server;
  let client: SupabaseClient;
  let objects: Map<string, Buffer>;
  let downloads: number;
  let hang: boolean;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'cura-sync-blobs-'));
    source = join(directory, 'source.bin');
    await writeFile(source, bytes);
    paths = {
      data: directory,
      cache: join(directory, 'cache'),
      log: join(directory, 'logs'),
    };
    objects = new Map();
    downloads = 0;
    hang = false;
    server = createServer(async (request, response) => {
      const object =
        request.url?.replace('/storage/v1/object/cura-sync-objects/', '') ?? '';
      if (request.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk as Buffer);
        response.setHeader('content-type', 'application/json');
        if (objects.has(object)) {
          response.writeHead(409);
          response.end(
            '{"message":"The resource already exists","statusCode":"409"}',
          );
          return;
        }
        expect(request.headers['x-upsert']).toBe('false');
        objects.set(object, Buffer.concat(chunks));
        response.end(JSON.stringify({ Id: randomUUID(), Key: object }));
        return;
      }
      downloads++;
      const value = objects.get(object);
      if (!value) {
        response.writeHead(404);
        response.end('{"message":"missing"}');
        return;
      }
      response.setHeader('content-type', 'application/octet-stream');
      if (hang) {
        response.write(value.subarray(0, 1));
        return;
      }
      response.end(value);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Fixture failed to listen');
    client = createClient(
      `http://127.0.0.1:${address.port}`,
      'sb_publishable_fixture',
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
  });
  afterEach(async () => {
    await client.auth.stopAutoRefresh();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  it('checks local bytes, rejects invalid paths and bounded metadata without remote requests', async () => {
    await verifyFile(source, hash, bytes.length);
    await expect(
      verifyFile(source, hash, bytes.length - 1),
    ).rejects.toMatchObject({ code: 'SYNC_BLOB_INTEGRITY' });
    await expect(
      verifyFile(source, 'a'.repeat(64), bytes.length),
    ).rejects.toMatchObject({ code: 'SYNC_BLOB_INTEGRITY' });
    await expect(
      verifyFile(join(directory, 'missing-private-name'), hash, bytes.length),
    ).rejects.toMatchObject({ code: 'SYNC_BLOB_MISSING' });
    await expect(
      materializeObject(client, paths, '../other', file),
    ).rejects.toMatchObject({ code: 'SYNC_BLOB_INVALID' });
    await expect(
      materializeObject(client, paths, libraryId, {
        ...file,
        hash: '../escape',
      }),
    ).rejects.toMatchObject({ code: 'SYNC_BLOB_INVALID' });
    await expect(
      materializeObject(client, paths, libraryId, {
        ...file,
        size: 512 * 1024 * 1024 + 1,
      }),
    ).rejects.toMatchObject({ code: 'SYNC_BLOB_LIMIT' });
    await expect(
      materializeObject(client, paths, libraryId, {
        ...file,
        type: 'image/png\r\nSecret: value',
      }),
    ).rejects.toMatchObject({ code: 'SYNC_BLOB_INVALID' });
    expect(downloads).toBe(0);
  });

  it('uploads once and verifies exact remote bytes on an existing-object retry', async () => {
    await ensureRemoteObject(client, libraryId, { ...file, source });
    expect(objects.get(`${libraryId}/${hash}`)).toEqual(bytes);
    await ensureRemoteObject(client, libraryId, { ...file, source });
    expect(downloads).toBe(1);
    objects.set(`${libraryId}/${hash}`, Buffer.from('poisoned'));
    await expect(
      ensureRemoteObject(client, libraryId, { ...file, source }),
    ).rejects.toMatchObject({ code: 'SYNC_BLOB_INTEGRITY' });
  });

  it('materializes atomically in the existing flat object store and reuses verified local bytes', async () => {
    objects.set(`${libraryId}/${hash}`, bytes);
    const result = await materializeObject(client, paths, libraryId, file);
    expect(result).toBe(join(directory, 'objects', hash));
    expect(await readFile(result)).toEqual(bytes);
    expect(await readdir(join(directory, 'objects'))).toEqual([hash]);
    expect(await materializeObject(client, paths, libraryId, file)).toBe(
      result,
    );
    expect(downloads).toBe(1);
  });

  it('rejects truncated, oversized and same-size corrupt responses while preserving existing bytes', async () => {
    await mkdir(join(directory, 'objects'));
    const destination = join(directory, 'objects', hash);
    const existing = Buffer.from(
      'Existing local bytes stay until a verified replacement is ready',
    );
    await writeFile(destination, existing);
    for (const response of [
      bytes.subarray(0, -1),
      Buffer.concat([bytes, Buffer.from('extra')]),
      Buffer.alloc(bytes.length),
    ]) {
      objects.set(`${libraryId}/${hash}`, response);
      await expect(
        materializeObject(client, paths, libraryId, file),
      ).rejects.toMatchObject({ code: 'SYNC_BLOB_INTEGRITY' });
      expect(await readFile(destination)).toEqual(existing);
      expect(await readdir(join(directory, 'objects'))).toEqual([hash]);
    }
    objects.set(`${libraryId}/${hash}`, bytes);
    await materializeObject(client, paths, libraryId, file);
    expect(await readFile(destination)).toEqual(bytes);
  });

  it('cancels a stalled stream and cleans the private partial file', async () => {
    objects.set(`${libraryId}/${hash}`, bytes);
    hang = true;
    const controller = new AbortController();
    const receiving = materializeObject(
      client,
      paths,
      libraryId,
      file,
      controller.signal,
    );
    while (downloads === 0)
      await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    await expect(receiving).rejects.toMatchObject({ code: 'SYNC_CANCELLED' });
    expect(await readdir(join(directory, 'objects'))).toEqual([]);
    await expect(
      verifyFile(source, hash, bytes.length, controller.signal),
    ).rejects.toMatchObject({ code: 'SYNC_CANCELLED' });
  });

  it('handles concurrent downloads of the same hash without unverified destination bytes', async () => {
    objects.set(`${libraryId}/${hash}`, bytes);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        materializeObject(client, paths, libraryId, file),
      ),
    );
    expect(new Set(results).size).toBe(1);
    expect(await readFile(results[0]!)).toEqual(bytes);
    expect(await readdir(join(directory, 'objects'))).toEqual([hash]);
  });
});
