import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SyncAuth } from '../src/sync/auth.js';
import { ensureRemoteObject, materializeObject } from '../src/sync/blobs.js';
import type { UserPaths } from '../src/paths.js';

const configurationPath = process.env.CURA_SYNC_TEST_STATUS;
const cloud = configurationPath ? describe : describe.skip;

// This suite creates its own accounts/library and never resets a schema.
cloud('real Supabase server Auth and streaming objects', () => {
  let directory: string;
  let one: SyncAuth;
  let two: SyncAuth;
  let viewer: SyncAuth;
  let onePaths: UserPaths;
  let twoPaths: UserPaths;
  let viewerPaths: UserPaths;
  let environment: NodeJS.ProcessEnv;
  const libraryId = randomUUID();
  const bytes = Buffer.from('Real Supabase immutable Cura object transfer');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const file = { hash, size: bytes.length, type: 'application/octet-stream' };
  const instances: SyncAuth[] = [];
  const paths = (name: string): UserPaths => ({
    data: join(directory, name),
    cache: join(directory, name, 'cache'),
    log: join(directory, name, 'logs'),
  });

  beforeAll(async () => {
    const config = JSON.parse(await readFile(configurationPath!, 'utf8')) as {
      API_URL: string;
      ANON_KEY: string;
    };
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(
        new URL(config.API_URL).hostname,
      )
    ) {
      throw new Error('Only a disposable loopback Supabase stack is allowed.');
    }
    environment = {
      CURA_SUPABASE_URL: config.API_URL,
      CURA_SUPABASE_ANON_KEY: config.ANON_KEY,
    };
    directory = await mkdtemp(join(tmpdir(), 'cura-real-auth-'));
    onePaths = paths('one');
    twoPaths = paths('two');
    viewerPaths = paths('viewer');
    one = new SyncAuth(onePaths, environment);
    two = new SyncAuth(twoPaths, environment);
    viewer = new SyncAuth(viewerPaths, environment);
    instances.push(one, two, viewer);
    async function signup(label: string) {
      const credentials = {
        email: `cura-auth-${label}-${randomUUID()}@example.test`,
        password: randomBytes(24).toString('base64url'),
      };
      const response = await fetch(`${config.API_URL}/auth/v1/signup`, {
        method: 'POST',
        headers: {
          apikey: config.ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials),
      });
      expect(response.status).toBe(200);
      return credentials;
    }
    const ownerCredentials = await signup('owner');
    const viewerCredentials = await signup('viewer');
    await one.signIn(ownerCredentials);
    await two.signIn(ownerCredentials);
    await viewer.signIn(viewerCredentials);
  }, 20_000);
  afterAll(async () => {
    await Promise.all(instances.map((instance) => instance.close()));
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('restores a private session and refreshes it using actual GoTrue', async () => {
    expect(one.status().auth).toBe('signed-in');
    expect(two.status().account).toEqual(one.status().account);
    const before = JSON.parse(
      await readFile(join(onePaths.data, 'sync', 'auth.json'), 'utf8'),
    ) as { refreshToken: string };
    await one.refresh();
    const after = JSON.parse(
      await readFile(join(onePaths.data, 'sync', 'auth.json'), 'utf8'),
    ) as { refreshToken: string };
    expect(after.refreshToken).not.toBe(before.refreshToken);
    await one.close();
    one = new SyncAuth(onePaths, environment);
    instances.push(one);
    await one.initialize();
    expect(one.status().auth).toBe('signed-in');
    expect(one.status().account).toEqual(two.status().account);
    expect(JSON.stringify(one.status())).not.toContain(after.refreshToken);
  });

  it('publishes an isolated library and transfers exact bytes between independent data directories', async () => {
    const client = one.client();
    const created = await client.rpc('cura_sync_create_library', {
      p_library_id: libraryId,
      p_name: 'Auth object integration',
      p_operation_id: randomUUID(),
    });
    expect(created.error).toBeNull();
    const source = join(onePaths.data, 'retained.bin');
    await writeFile(source, bytes);
    await ensureRemoteObject(client, libraryId, { ...file, source });
    await ensureRemoteObject(client, libraryId, { ...file, source });
    const now = new Date().toISOString();
    const published = await client.rpc('cura_sync_commit', {
      p_library_id: libraryId,
      p_operation_id: randomUUID(),
      p_changes: [
        {
          kind: 'library',
          key: libraryId,
          expectedRevision: '0',
          tombstone: false,
          payload: {
            kind: 'library',
            id: libraryId,
            libraryId,
            data: {
              id: libraryId,
              name: 'Auth object integration',
              createdAt: now,
              updatedAt: now,
            },
          },
        },
      ],
    });
    expect(published.error).toBeNull();
    const destination = await materializeObject(
      two.client(),
      twoPaths,
      libraryId,
      file,
    );
    expect(destination).toBe(join(twoPaths.data, 'objects', hash));
    expect(await readFile(destination)).toEqual(bytes);
    const membership = await client.rpc('cura_sync_set_member', {
      p_library_id: libraryId,
      p_user_id: viewer.status().account!.id,
      p_role: 'viewer',
    });
    expect(membership.error).toBeNull();
    expect(
      await readFile(
        await materializeObject(viewer.client(), viewerPaths, libraryId, file),
      ),
    ).toEqual(bytes);
    const deniedBytes = Buffer.from('Viewer must not upload this');
    const viewerSource = join(viewerPaths.data, 'source.bin');
    await writeFile(viewerSource, deniedBytes);
    await expect(
      ensureRemoteObject(viewer.client(), libraryId, {
        hash: createHash('sha256').update(deniedBytes).digest('hex'),
        size: deniedBytes.length,
        type: file.type,
        source: viewerSource,
      }),
    ).rejects.toMatchObject({ code: 'SYNC_BLOB_TRANSFER' });
  });

  it('rejects a poisoned hash path on both existing upload and received download', async () => {
    const correct = Buffer.from('Expected bytes behind poisoned hash');
    const poisonedHash = createHash('sha256').update(correct).digest('hex');
    const metadata = {
      hash: poisonedHash,
      size: correct.length,
      type: file.type,
    };
    const poison = await one
      .client()
      .storage.from('cura-sync-objects')
      .upload(`${libraryId}/${poisonedHash}`, Buffer.from('Wrong bytes'), {
        upsert: false,
        contentType: file.type,
      });
    expect(poison.error).toBeNull();
    const source = join(onePaths.data, 'poisoned-source.bin');
    await writeFile(source, correct);
    await expect(
      ensureRemoteObject(one.client(), libraryId, { ...metadata, source }),
    ).rejects.toMatchObject({ code: 'SYNC_BLOB_INTEGRITY' });
    await expect(
      materializeObject(two.client(), twoPaths, libraryId, metadata),
    ).rejects.toMatchObject({ code: 'SYNC_BLOB_INTEGRITY' });
    expect(await readdir(join(twoPaths.data, 'objects'))).toEqual([hash]);
  });

  it('signs out only this device and leaves the other actual session usable', async () => {
    await one.signOut();
    expect(one.status().auth).toBe('signed-out');
    expect(await readdir(join(onePaths.data, 'sync'))).toEqual([]);
    await two.refresh();
    expect(two.status().auth).toBe('signed-in');
    const manifest = await two
      .client()
      .rpc('cura_sync_manifest', { p_library_id: libraryId });
    expect(manifest.error).toBeNull();
  });
});
