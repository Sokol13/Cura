import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { SyncCloud } from '../src/sync/cloud.js';
import { SyncError } from '../src/sync/errors.js';
import { SyncService } from '../src/sync/service.js';
import { registerSyncRoutes } from '../src/sync/routes.js';
import { fixture } from './sync-test-fixtures.js';
it('keeps unconfigured local mode usable with validated secret-free status and auth errors', async () => {
  const f = await fixture(),
    service = new SyncService(f.db, f.paths, {
      environment: {},
      intervalMs: 0,
    }),
    app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const value = error as Error & { statusCode?: number; code?: string };
    reply
      .code(value.statusCode ?? 400)
      .send({ error: value.message, code: value.code ?? 'INVALID_REQUEST' });
  });
  registerSyncRoutes(app, service);
  await service.initialize();
  try {
    const status = await app.inject({ url: '/api/sync/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({
      configured: false,
      auth: 'unconfigured',
      account: null,
      error: null,
      links: [],
    });
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/sync/auth/sign-in',
      payload: { email: 'invalid', password: '', accessToken: 'forbidden' },
    });
    expect(malformed.statusCode).toBe(400);
    const publish = await app.inject({
      method: 'POST',
      url: '/api/sync/publish',
      payload: { libraryId: f.library!.id },
    });
    expect(publish.statusCode).toBe(401);
    expect(f.catalog.listLibraries()).toHaveLength(1);
  } finally {
    await service.close();
    await app.close();
  }
});
it('cancels and drains old-account jobs and controls before changing credentials', async () => {
  const f = await fixture(),
    service = new SyncService(f.db, f.paths, {
      environment: {},
      intervalMs: 0,
    });
  await service.initialize();
  let account = { id: randomUUID(), email: 'old@example.test' };
  vi.spyOn(service.auth, 'status').mockImplementation(() => ({
    auth: 'signed-in',
    account,
    error: null,
  }));
  const link = service.state.create(
    f.library!.id,
    f.library!.name,
    'owner',
    true,
    service.auth.projectId,
    account.id,
  );
  const cloud = (service as unknown as { cloud: SyncCloud }).cloud;
  const started: AbortSignal[] = [];
  const releases: Array<() => void> = [];
  vi.spyOn(cloud, 'list').mockImplementation(
    (signal) =>
      new Promise((_resolve, reject) => {
        started.push(signal!);
        releases.push(() =>
          reject(new SyncError('Cancelled', 'SYNC_CANCELLED', 499)),
        );
      }),
  );
  service.run(link.id);
  const control = service.libraries().catch((error) => error);
  await vi.waitFor(() => expect(started).toHaveLength(2));
  const signIn = vi
    .spyOn(service.auth, 'signIn')
    .mockImplementation(async () => {
      account = { id: randomUUID(), email: 'new@example.test' };
    });
  const change = service.signIn({
    email: 'new@example.test',
    password: 'test-only',
  });
  await vi.waitFor(() =>
    expect(started.every((signal) => signal.aborted)).toBe(true),
  );
  expect(signIn).not.toHaveBeenCalled();
  releases.forEach((release) => release());
  await change;
  await control;
  expect(signIn).toHaveBeenCalledOnce();
  expect(service.status().links).toEqual([]);
  await service.close();
});
it('queues a resumed cycle when pause cancellation has not finished yet', async () => {
  const f = await fixture(),
    service = new SyncService(f.db, f.paths, {
      environment: {},
      intervalMs: 0,
    });
  await service.initialize();
  const account = { id: randomUUID(), email: 'owner@example.test' };
  vi.spyOn(service.auth, 'status').mockReturnValue({
    auth: 'signed-in',
    account,
    error: null,
  });
  const link = service.state.create(
    f.library!.id,
    f.library!.name,
    'owner',
    true,
    service.auth.projectId,
    account.id,
  );
  const cloud = (service as unknown as { cloud: SyncCloud }).cloud;
  let release: () => void = () => {};
  const list = vi
    .spyOn(cloud, 'list')
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          release = () =>
            reject(new SyncError('Cancelled', 'SYNC_CANCELLED', 499));
        }),
    )
    .mockResolvedValue([]);
  service.run(link.id);
  await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
  service.patch(link.id, { paused: true });
  service.patch(link.id, { paused: false });
  release();
  await service.idle();
  expect(list).toHaveBeenCalledTimes(2);
  expect(service.state.get(link.id).paused).toBe(false);
  await service.close();
});
