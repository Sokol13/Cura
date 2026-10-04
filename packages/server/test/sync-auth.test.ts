import { createServer, type Server } from 'node:http';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SyncAuth } from '../src/sync/auth.js';
import type { UserPaths } from '../src/paths.js';

const key = 'sb_publishable_fixture';
const account = { id: randomUUID(), email: 'owner@example.test' };
const user = {
  ...account,
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: { sensitive: 'omit-me' },
  created_at: '2026-10-04T00:00:00.000Z',
};
function token(expiresAt = Math.floor(Date.now() / 1000) + 3600) {
  return [
    Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
    Buffer.from(
      JSON.stringify({
        sub: account.id,
        exp: expiresAt,
        role: 'authenticated',
      }),
    ).toString('base64url'),
    Buffer.from('fixture-signature').toString('base64url'),
  ].join('.');
}

describe('server-only sync authentication', () => {
  let directory: string;
  let paths: UserPaths;
  let server: Server;
  let url: string;
  let unavailable: boolean;
  let rejected: boolean;
  let refreshes: number;
  let requests: string[];
  const instances: SyncAuth[] = [];

  function auth(
    environment: NodeJS.ProcessEnv = {
      CURA_SUPABASE_URL: url,
      CURA_SUPABASE_ANON_KEY: key,
    },
  ) {
    const value = new SyncAuth(paths, environment);
    instances.push(value);
    return value;
  }
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'cura-sync-auth-'));
    paths = {
      data: directory,
      cache: join(directory, 'cache'),
      log: join(directory, 'logs'),
    };
    unavailable = false;
    rejected = false;
    refreshes = 0;
    requests = [];
    server = createServer(async (request, response) => {
      requests.push(request.url ?? '');
      for await (const chunk of request) {
        void chunk; // Consume password/token privately.
      }
      response.setHeader('content-type', 'application/json');
      if (unavailable) {
        response.writeHead(503);
        response.end('{"message":"private provider error"}');
        return;
      }
      if (request.url?.startsWith('/auth/v1/user')) {
        response.end(JSON.stringify(user));
        return;
      }
      if (request.url?.startsWith('/auth/v1/logout')) {
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.url?.includes('grant_type=refresh_token')) {
        if (rejected) {
          response.writeHead(400);
          response.end(
            '{"message":"private token error","error_code":"refresh_token_not_found"}',
          );
          return;
        }
        refreshes++;
      }
      response.end(
        JSON.stringify({
          access_token: token(),
          refresh_token: `private-refresh-${refreshes}`,
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user,
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Fixture failed to listen');
    url = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    await Promise.all(instances.splice(0).map((value) => value.close()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  it('stays local without configuration and reports partial or unsafe configuration safely', async () => {
    const local = auth({});
    await local.initialize();
    expect(local.configured).toBe(false);
    expect(local.status()).toEqual({
      auth: 'unconfigured',
      account: null,
      error: null,
    });
    expect(() => local.client()).toThrowError('Cloud sync is not configured.');
    for (const environment of [
      { CURA_SUPABASE_URL: url },
      { CURA_SUPABASE_URL: 'http://example.com', CURA_SUPABASE_ANON_KEY: key },
      { CURA_SUPABASE_URL: `${url}/auth/v1`, CURA_SUPABASE_ANON_KEY: key },
      {
        CURA_SUPABASE_URL: `${url}?secret=never-show`,
        CURA_SUPABASE_ANON_KEY: key,
      },
      {
        CURA_SUPABASE_URL: `${url}#secret=never-show`,
        CURA_SUPABASE_ANON_KEY: key,
      },
      {
        CURA_SUPABASE_URL: 'https://user:never-show@example.com',
        CURA_SUPABASE_ANON_KEY: key,
      },
      {
        CURA_SUPABASE_URL: url,
        CURA_SUPABASE_ANON_KEY: 'sb_secret_never-show',
      },
      {
        CURA_SUPABASE_URL: url,
        CURA_SUPABASE_ANON_KEY: `header.${Buffer.from('{"role":"service_role"}').toString('base64url')}.signature`,
      },
    ]) {
      const invalid = auth(environment);
      await invalid.initialize();
      expect(invalid.configured).toBe(false);
      expect(invalid.status().error?.code).toBe('SYNC_CONFIG');
      expect(JSON.stringify(invalid.status())).not.toContain('never-show');
    }
    expect(requests).toEqual([]);
  });

  it('atomically persists minimal credentials privately and restores the same account', async () => {
    const one = auth();
    await one.signIn({ email: account.email, password: 'private-password' });
    const filename = join(directory, 'sync', 'auth.json');
    const saved = JSON.parse(await readFile(filename, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(saved.projectId).toBe(one.projectId);
    expect(saved.account).toEqual(account);
    expect(saved.refreshToken).toBe('private-refresh-0');
    expect(JSON.stringify(saved)).not.toContain('private-password');
    expect(JSON.stringify(saved)).not.toContain('omit-me');
    expect(await readdir(join(directory, 'sync'))).toEqual(['auth.json']);
    if (process.platform !== 'win32') {
      expect((await stat(filename)).mode & 0o777).toBe(0o600);
      expect((await stat(join(directory, 'sync'))).mode & 0o777).toBe(0o700);
    }
    expect(one.status()).toEqual({ auth: 'signed-in', account, error: null });
    expect(JSON.stringify(one.status())).not.toContain('private-refresh');
    expect(JSON.stringify(one)).not.toContain('private-refresh');
    const two = auth();
    await two.initialize();
    expect(two.status()).toEqual(one.status());
    expect(two.projectId).toBe(one.projectId);
    await two.refresh();
    expect(
      (JSON.parse(await readFile(filename, 'utf8')) as Record<string, unknown>)
        .refreshToken,
    ).toBe('private-refresh-1');
  });

  it('persists SDK refresh callbacks and serializes sign-out after refresh', async () => {
    const value = auth();
    await value.signIn({ email: account.email, password: 'private-password' });
    const refreshed = await value.client().auth.refreshSession();
    expect(refreshed.error).toBeNull();
    await value.close();
    const saved = JSON.parse(
      await readFile(join(directory, 'sync', 'auth.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(saved.refreshToken).toBe('private-refresh-1');
    const reopened = auth();
    await reopened.initialize();
    await Promise.all([reopened.refresh(), reopened.signOut()]);
    expect(reopened.status()).toEqual({
      auth: 'signed-out',
      account: null,
      error: null,
    });
    expect(await readdir(join(directory, 'sync'))).toEqual([]);
    expect(
      requests.some((request) => request === '/auth/v1/logout?scope=local'),
    ).toBe(true);
  });

  it('retains cached account and persisted credentials during offline startup, then recovers', async () => {
    const one = auth();
    await one.signIn({ email: account.email, password: 'private-password' });
    await one.close();
    unavailable = true;
    const two = auth();
    await two.initialize();
    expect(two.status().auth).toBe('offline');
    expect(two.status().account).toEqual(account);
    expect(two.status().error?.code).toBe('SYNC_OFFLINE');
    expect(() => two.client()).toThrowError('Cloud connection is unavailable.');
    expect(JSON.stringify(two.status())).not.toContain('private provider');
    unavailable = false;
    await two.refresh();
    expect(two.status()).toEqual({ auth: 'signed-in', account, error: null });
  });

  it('marks revoked refresh credentials expired without losing the cached account', async () => {
    const value = auth();
    await value.signIn({ email: account.email, password: 'private-password' });
    rejected = true;
    await expect(value.refresh()).rejects.toMatchObject({
      code: 'SYNC_AUTH_EXPIRED',
    });
    expect(value.status().auth).toBe('expired');
    expect(value.status().account).toEqual(account);
    expect(JSON.stringify(value.status())).not.toContain('private token');
    expect(() => value.client()).toThrowError('Cloud sign-in has expired.');
  });

  it('never sends a saved session to a different project and rejects malformed private files', async () => {
    const one = auth();
    await one.signIn({ email: account.email, password: 'private-password' });
    await one.close();
    const before = requests.length;
    const different = auth({
      CURA_SUPABASE_URL: url.replace('127.0.0.1', 'localhost'),
      CURA_SUPABASE_ANON_KEY: key,
    });
    await different.initialize();
    expect(different.status().error?.code).toBe('SYNC_AUTH_PROJECT');
    expect(different.status().account).toBeNull();
    expect(requests).toHaveLength(before);
    await writeFile(
      join(directory, 'sync', 'auth.json'),
      '{"accessToken":"private-malformed"}',
    );
    const malformed = auth();
    await malformed.initialize();
    expect(malformed.status().error?.code).toBe('SYNC_AUTH_STORAGE');
    expect(JSON.stringify(malformed.status())).not.toContain(
      'private-malformed',
    );
  });
});
