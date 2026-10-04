import { createHash, randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/database.js';
import { CatalogStore } from '../src/catalog-store.js';
import { SyncAuth } from '../src/sync/auth.js';
import { SyncService } from '../src/sync/service.js';

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});
async function deadline<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 1500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function heldCloud(expired = false) {
  const directory = await mkdtemp(join(tmpdir(), 'cura-sync-startup-'));
  const paths = {
    data: join(directory, 'data'),
    cache: join(directory, 'cache'),
    log: join(directory, 'log'),
  };
  const account = { id: randomUUID(), email: 'saved@example.test' };
  const replacement = { id: randomUUID(), email: 'new@example.test' };
  const user = (value = account) => ({
    ...value,
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-10-04T00:00:00.000Z',
  });
  const token = (id: string, seconds = 3600) =>
    [
      Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
      Buffer.from(
        JSON.stringify({
          sub: id,
          exp: Math.floor(Date.now() / 1000) + seconds,
          role: 'authenticated',
        }),
      ).toString('base64url'),
      Buffer.from('fixture-signature').toString('base64url'),
    ].join('.');
  const session = (value = account) => ({
    access_token: token(value.id),
    refresh_token: 'private-rotated-fixture',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: user(value),
  });
  const held: Array<{ response: ServerResponse; refresh: boolean }> = [];
  const requests: string[] = [];
  let released = false;
  const server = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    const url = request.url ?? '';
    requests.push(url);
    response.setHeader('content-type', 'application/json');
    if (url.includes('grant_type=password')) {
      response.end(JSON.stringify(session(replacement)));
    } else if (
      url.startsWith('/auth/v1/user') ||
      url.includes('grant_type=refresh_token')
    ) {
      const refresh = url.includes('refresh_token');
      if (released) response.end(JSON.stringify(refresh ? session() : user()));
      else held.push({ response, refresh });
    } else {
      response.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Fixture address');
  const url = `http://127.0.0.1:${address.port}`;
  const environment = {
    CURA_SUPABASE_URL: url,
    CURA_SUPABASE_ANON_KEY: 'sb_publishable_fixture',
  };
  await mkdir(join(paths.data, 'sync'), { recursive: true, mode: 0o700 });
  const filename = join(paths.data, 'sync', 'auth.json');
  const saved = JSON.stringify({
    version: 1,
    projectId: createHash('sha256').update(url).digest('hex'),
    accessToken: token(account.id, expired ? -3600 : 3600),
    refreshToken: 'private-saved-fixture',
    expiresAt: Math.floor(Date.now() / 1000) + (expired ? -3600 : 3600),
    account,
  });
  await writeFile(filename, saved, { mode: 0o600 });
  const release = () => {
    if (released) return;
    released = true;
    for (const { response, refresh } of held)
      if (!response.destroyed)
        response.end(JSON.stringify(refresh ? session() : user()));
  };
  cleanup.push(async () => {
    release();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  return {
    paths,
    environment,
    filename,
    saved,
    account,
    replacement,
    requests,
    release,
    held,
  };
}

it('serves local HTTP APIs while saved cloud sign-in is held, then drains auth before closing the database', async () => {
  const f = await heldCloud();
  for (const [key, value] of Object.entries(f.environment))
    vi.stubEnv(key, value);
  const db = openDatabase(f.paths);
  const library = new CatalogStore(db).createLibrary({
    name: 'Offline local library',
  });
  const order: string[] = [];
  const originalClose = SyncAuth.prototype.close;
  vi.spyOn(SyncAuth.prototype, 'close').mockImplementation(async function (
    this: SyncAuth,
  ) {
    expect(db.sqlite.open).toBe(true);
    await originalClose.call(this);
    order.push('auth');
  });
  const starting = createApp({
    database: db,
    paths: f.paths,
    staticRoot: false,
    onClose: () => {
      order.push('database');
      db.close();
    },
  });
  cleanup.push(async () => {
    f.release();
    const app = await starting;
    await app.close();
    if (db.sqlite.open) db.close();
  });
  const app = await deadline(
    starting,
    'Local startup waited for the cloud response',
  );
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Local address');
  const origin = `http://127.0.0.1:${address.port}`;
  await vi.waitFor(() => expect(f.held).toHaveLength(1));
  expect(await (await fetch(`${origin}/api/health`)).json()).toEqual({
    status: 'ok',
  });
  expect(await (await fetch(`${origin}/api/libraries`)).json()).toEqual([
    library,
  ]);
  expect(f.held[0]!.response.writableEnded).toBe(false);
  await deadline(app.close(), 'Shutdown waited for the cloud response');
  expect(order).toEqual(['auth', 'database']);
  await vi.waitFor(() => expect(f.held[0]!.response.destroyed).toBe(true));
  expect(await readFile(f.filename, 'utf8')).toBe(f.saved);
});

it.each([false, true])(
  'cancels retained-session restoration with expired=%s without deleting credentials or retrying',
  async (expired) => {
    const f = await heldCloud(expired),
      auth = new SyncAuth(f.paths, f.environment);
    cleanup.push(async () => {
      f.release();
      await auth.close();
    });
    const initialization = auth.initialize();
    expect(auth.initialize()).toBe(initialization);
    await vi.waitFor(() => expect(f.held).toHaveLength(1));
    const closing = auth.close();
    await deadline(closing, 'Auth shutdown did not abort its pending request');
    await initialization;
    expect(f.requests).toHaveLength(1);
    expect(await readFile(f.filename, 'utf8')).toBe(f.saved);
    expect(() => auth.client()).toThrow();
  },
);

it('joins repeated service initialization and queued sign-in without restoring the old account afterward', async () => {
  const f = await heldCloud(),
    db = openDatabase(f.paths),
    service = new SyncService(db, f.paths, {
      environment: f.environment,
      intervalMs: 0,
    });
  cleanup.push(async () => {
    f.release();
    await service.close();
    db.close();
  });
  const initialized = service.initialize();
  expect(service.initialize()).toBe(initialized);
  await vi.waitFor(() => expect(f.held).toHaveLength(1));
  const signingIn = service.signIn({
    email: f.replacement.email,
    password: 'private-password-fixture',
  });
  expect(f.requests).toHaveLength(1);
  f.release();
  await Promise.all([initialized, signingIn]);
  expect(service.status().account).toEqual(f.replacement);
  expect(
    f.requests.filter((path) => path.startsWith('/auth/v1/user')),
  ).toHaveLength(1);
  expect(
    f.requests.filter((path) => path.includes('grant_type=password')),
  ).toHaveLength(1);
  expect(JSON.parse(await readFile(f.filename, 'utf8')).account).toEqual(
    f.replacement,
  );
});

it('drains a sign-in queued behind saved-session restoration during shutdown', async () => {
  const f = await heldCloud(),
    db = openDatabase(f.paths);
  const service = new SyncService(db, f.paths, {
    environment: f.environment,
    intervalMs: 0,
  });
  cleanup.push(async () => {
    f.release();
    await service.close();
    db.close();
  });
  const initialized = service.initialize();
  await vi.waitFor(() => expect(f.held).toHaveLength(1));
  const signingIn = service
    .signIn({
      email: f.replacement.email,
      password: 'private-password-fixture',
    })
    .catch((error: unknown) => error);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await deadline(
    service.close(),
    'Shutdown waited for a queued sign-in before aborting restoration',
  );
  await initialized;
  expect(await signingIn).toMatchObject({ code: 'SYNC_CANCELLED' });
  expect(f.requests).toHaveLength(1);
  expect(await readFile(f.filename, 'utf8')).toBe(f.saved);
});

it('keeps local startup usable and sanitizes an unexpected background initialization failure', async () => {
  const f = await heldCloud(),
    db = openDatabase(f.paths),
    messages: string[] = [];
  vi.spyOn(SyncService.prototype, 'initialize').mockRejectedValue(
    new Error('private-provider-credential'),
  );
  const app = await createApp({
    database: db,
    paths: f.paths,
    staticRoot: false,
    loggerInstance: pino(
      { level: 'error' },
      { write: (text) => messages.push(text) },
    ),
  });
  cleanup.push(async () => {
    await app.close();
    db.close();
  });
  expect((await app.inject('/api/health')).statusCode).toBe(200);
  expect(messages.join('')).toContain('SYNC_INITIALIZATION');
  expect(messages.join('')).not.toContain('private-provider-credential');
});
