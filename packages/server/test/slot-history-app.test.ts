import { createHash, randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { SlotHistorySchema, type SlotActor } from '@cura/shared';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/database.js';
import { CatalogStore } from '../src/catalog-store.js';
import { BoardStore } from '../src/boards/store.js';
import { SyncAuth } from '../src/sync/auth.js';
const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function fixture(saved = false) {
  const directory = await mkdtemp(join(tmpdir(), 'cura-history-app-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const paths = {
    data: join(directory, 'data'),
    cache: join(directory, 'cache'),
    log: join(directory, 'log'),
  };
  const db = openDatabase(paths);
  cleanups.push(() => db.close());
  const catalog = new CatalogStore(db),
    boards = new BoardStore(db);
  const library = catalog.createLibrary({ name: 'App history' });
  let document = boards.createBoard(library.id, { name: 'History' });
  document = boards.createSlot(document.board.id, {
    expectedRevision: 0,
    label: 'Hero',
  });
  let held: ServerResponse | undefined;
  const account = { id: randomUUID(), email: 'verified@example.test' };
  if (saved) {
    const server = createServer((request, response) => {
      if (request.url?.startsWith('/auth/v1/user')) held = response;
      else {
        response.setHeader('content-type', 'application/json');
        response.end('{}');
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    cleanups.push(() => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('fixture address');
    const url = `http://127.0.0.1:${address.port}`;
    vi.stubEnv('CURA_SUPABASE_URL', url);
    vi.stubEnv('CURA_SUPABASE_ANON_KEY', 'sb_publishable_fixture');
    const accessToken = [
      Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
      Buffer.from(
        JSON.stringify({
          sub: account.id,
          exp: Math.floor(Date.now() / 1000) + 3600,
          role: 'authenticated',
        }),
      ).toString('base64url'),
      'fixture',
    ].join('.');
    await mkdir(join(paths.data, 'sync'), { recursive: true, mode: 0o700 });
    await writeFile(
      join(paths.data, 'sync', 'auth.json'),
      JSON.stringify({
        version: 1,
        projectId: createHash('sha256').update(url).digest('hex'),
        accessToken,
        refreshToken: 'private-fixture',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        account,
      }),
      { mode: 0o600 },
    );
  } else {
    vi.stubEnv('CURA_SUPABASE_URL', '');
    vi.stubEnv('CURA_SUPABASE_ANON_KEY', '');
  }
  const app = await createApp({ database: db, paths, staticRoot: false });
  cleanups.push(() => app.close());
  await app.ready();
  const slotId = document.slots[0]!.id;
  const assign = async (
    expectedRevision: number,
    pin: { assetId: string; versionId: string } | null,
    actor?: SlotActor,
  ) =>
    app.inject({
      method: 'PUT',
      url: `/api/slots/${slotId}/assignment`,
      payload: { expectedRevision, pin, ...(actor ? { actor } : {}) },
    });
  const history = async () =>
    SlotHistorySchema.parse(
      (await app.inject(`/api/slots/${slotId}/history`)).json(),
    );
  const upload = await app.inject({
    method: 'POST',
    url: `/api/libraries/${library.id}/upload?name=source.svg`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>',
    ),
  });
  expect(upload.statusCode).toBe(201);
  const asset = upload.json();
  return {
    app,
    account,
    assign,
    history,
    pin: {
      assetId: String(asset.id),
      versionId: String(asset.currentVersionId),
    },
    hasHeld: () => Boolean(held),
    release: () => {
      held?.setHeader('content-type', 'application/json');
      held?.end(
        JSON.stringify({
          ...account,
          aud: 'authenticated',
          app_metadata: {},
          user_metadata: {},
          created_at: '2026-01-01T00:00:00.000Z',
        }),
      );
    },
  };
}
it('uses only verified unexpired saved sign-in attribution at the actual board routes', async () => {
  const f = await fixture(true);
  await expect.poll(f.hasHeld).toBe(true);
  expect((await f.assign(0, f.pin)).statusCode).toBe(200);
  expect((await f.history())[0]?.actor).toEqual({ kind: 'local' });
  f.release();
  await expect
    .poll(async () => (await f.app.inject('/api/sync/status')).json().auth)
    .toBe('signed-in');
  expect((await f.assign(1, null)).statusCode).toBe(200);
  expect((await f.history())[0]?.actor).toEqual({
    kind: 'account',
    ...f.account,
  });
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 60 * 60 * 1000);
  expect((await f.assign(2, f.pin)).statusCode).toBe(200);
  expect((await f.history())[0]?.actor).toEqual({ kind: 'local' });
  expect(
    (
      await f.assign(3, null, {
        kind: 'account',
        id: randomUUID(),
        email: 'forged@example.test',
      })
    ).statusCode,
  ).toBe(400);
  expect(await f.history()).toHaveLength(3);
});
it('does not attribute a cached offline account to a local assignment', async () => {
  const f = await fixture();
  vi.spyOn(SyncAuth.prototype, 'status').mockReturnValue({
    auth: 'offline',
    account: f.account,
    error: null,
  });
  expect((await f.assign(0, f.pin)).statusCode).toBe(200);
  expect((await f.history())[0]?.actor).toEqual({ kind: 'local' });
});
