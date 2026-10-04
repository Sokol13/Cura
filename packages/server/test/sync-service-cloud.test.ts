import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer, request as forward } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { SyncService } from '../src/sync/service.js';
import { SyncCloud } from '../src/sync/cloud.js';
import { readPortableGraph, semanticHash } from '../src/sync/portable.js';
import { fixture, graphFixture } from './sync-test-fixtures.js';

const configured = process.env.CURA_SYNC_TEST_STATUS ? it : it.skip;
configured(
  'synchronizes complete two-device history, edits during acknowledgments, deletes, restart, offline and revoked viewer access',
  async () => {
    const config = JSON.parse(
      await readFile(process.env.CURA_SYNC_TEST_STATUS!, 'utf8'),
    ) as { API_URL: string; ANON_KEY: string };
    if (!['127.0.0.1', 'localhost'].includes(new URL(config.API_URL).hostname))
      throw new Error('Only disposable loopback Supabase is permitted');
    let offline = false;
    const gateway = createServer((request, response) => {
      if (offline) {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ message: 'Test transport unavailable' }));
        return;
      }
      const address = new URL(request.url!, config.API_URL);
      const upstream = forward(
        address,
        {
          method: request.method,
          headers: { ...request.headers, host: address.host },
        },
        (incoming) => {
          response.writeHead(incoming.statusCode!, incoming.headers);
          incoming.pipe(response);
        },
      );
      upstream.on('error', () => {
        response.writeHead(503);
        response.end();
      });
      request.pipe(upstream);
    });
    await new Promise<void>((resolve) =>
      gateway.listen(0, '127.0.0.1', resolve),
    );
    const environment = {
      CURA_SUPABASE_URL: `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`,
      CURA_SUPABASE_ANON_KEY: config.ANON_KEY,
    };
    const signup = async () => {
      const credentials = {
        email: `cura-service-${randomUUID()}@example.test`,
        password: randomBytes(24).toString('hex'),
      };
      const response = await fetch(`${config.API_URL}/auth/v1/signup`, {
        method: 'POST',
        headers: {
          apikey: config.ANON_KEY,
          'content-type': 'application/json',
        },
        body: JSON.stringify(credentials),
      });
      expect(response.status).toBe(200);
      return credentials;
    };
    const source = await graphFixture(),
      target = await fixture(false),
      third = await fixture(false),
      account = await signup(),
      viewerAccount = await signup();
    let one = new SyncService(source.db, source.paths, {
      environment,
      intervalMs: 0,
    });
    const two = new SyncService(target.db, target.paths, {
        environment,
        intervalMs: 0,
      }),
      viewer = new SyncService(third.db, third.paths, {
        environment,
        intervalMs: 0,
      });
    const run = async (service: SyncService, id: string) => {
      service.run(id);
      await service.idle();
      const link = service.state.get(id);
      expect(link.lastError).toBeNull();
      expect(link.state).toBe('idle');
    };
    try {
      await one.initialize();
      await two.initialize();
      await viewer.initialize();
      await one.signIn(account);
      await two.signIn(account);
      await viewer.signIn(viewerAccount);
      const first = await one.publish({ libraryId: source.library.id });
      await one.idle();
      expect(one.state.get(first.id).lastError).toBeNull();
      expect(one.state.get(first.id).state).toBe('idle');
      const second = await two.join({ libraryId: source.library.id });
      await two.idle();
      expect(two.state.get(second.id).lastError).toBeNull();
      expect(two.state.get(second.id).materialized).toBe(true);
      expect(readPortableGraph(target.db, source.library.id).records).toEqual(
        readPortableGraph(source.db, source.library.id).records,
      );
      expect(target.catalog.getAsset(source.asset.id).missing).toBe(false);
      const cloud = (one as unknown as { cloud: SyncCloud }).cloud,
        commit = cloud.commit.bind(cloud);
      const quiet = vi.spyOn(cloud, 'commit');
      const storage = vi.spyOn(one.auth.client().storage, 'from');
      source.catalog.updateVersionPreview(
        source.pin.versionId,
        '/private/cache-only.webp',
      );
      await run(one, first.id);
      expect(quiet).not.toHaveBeenCalled();
      expect(storage).not.toHaveBeenCalled();
      quiet.mockRestore();
      let edited = false;
      const race = vi
        .spyOn(cloud, 'commit')
        .mockImplementation(async (...args) => {
          const acknowledgment = await commit(...args);
          if (!edited) {
            edited = true;
            source.catalog.updateAsset(source.asset.id, {
              note: 'edit during acknowledgment',
            });
          }
          return acknowledgment;
        });
      source.catalog.updateAsset(source.asset.id, {
        note: 'submitted snapshot',
      });
      await run(one, first.id);
      race.mockRestore();
      expect(storage).not.toHaveBeenCalled();
      storage.mockRestore();
      expect(source.catalog.getAsset(source.asset.id).note).toBe(
        'edit during acknowledgment',
      );
      await run(two, second.id);
      expect(target.catalog.getAsset(source.asset.id).note).toBe(
        'edit during acknowledgment',
      );
      source.catalog.replaceAsset(
        source.asset.id,
        await source.file('owner replacement'),
        'owner.png',
      );
      target.catalog.replaceAsset(
        source.asset.id,
        await target.file('device replacement'),
        'device.png',
      );
      source.catalog.updateAsset(source.asset.id, { note: 'remote note' });
      target.catalog.updateAsset(source.asset.id, {
        note: 'winning local note',
      });
      await run(one, first.id);
      await run(two, second.id);
      await run(one, first.id);
      expect(source.catalog.getAsset(source.asset.id).note).toBe(
        'winning local note',
      );
      expect(source.catalog.listVersions(source.asset.id)).toHaveLength(4);
      expect(
        two
          .conflicts(second.id)
          .some((conflict) => conflict.entityId === source.asset.id),
      ).toBe(true);
      const originalAlias = source.catalog.getSource(
          source.root.id,
          '中文-é.png',
        )!,
        current = source.catalog.getAsset(source.asset.id).currentVersionId;
      source.catalog.ingest({
        libraryId: source.library.id,
        rootId: source.root.id,
        relativePath: '中文-é.png',
        actualRelativePath: '中文-é.png',
        processed: await source.file('v1'),
      });
      expect(source.catalog.getAsset(source.asset.id).currentVersionId).toBe(
        current,
      );
      expect(
        source.catalog.getSource(source.root.id, '中文-é.png')?.lastHash,
      ).toBe(originalAlias.lastHash);
      const brand = readPortableGraph(
        source.db,
        source.library.id,
      ).records.find((record) => record.kind === 'brand')!;
      source.brands.deleteBrand(brand.id);
      await run(one, first.id);
      await run(two, second.id);
      expect(
        readPortableGraph(target.db, source.library.id).records.some(
          (record) => record.id === brand.id,
        ),
      ).toBe(false);
      source.catalog.updateAsset(source.asset.id, { note: 'offline retained' });
      offline = true;
      one.run(first.id);
      await one.idle();
      expect(one.state.get(first.id).state).toBe('offline');
      expect(source.catalog.getAsset(source.asset.id).note).toBe(
        'offline retained',
      );
      offline = false;
      await run(one, first.id);
      const before = semanticHash(
        readPortableGraph(source.db, source.library.id).records,
      );
      await one.close();
      one = new SyncService(source.db, source.paths, {
        environment,
        intervalMs: 0,
      });
      await one.initialize();
      await one.idle();
      expect(one.status().account?.id).toBe(two.status().account?.id);
      expect(
        semanticHash(readPortableGraph(source.db, source.library.id).records),
      ).toBe(before);
      const viewerId = viewer.status().account!.id;
      await one.setMember(source.library.id, viewerId, { role: 'viewer' });
      const thirdLink = await viewer.join({ libraryId: source.library.id });
      await viewer.idle();
      expect(viewer.state.get(thirdLink.id).lastError).toBeNull();
      third.catalog.updateAsset(source.asset.id, {
        note: 'viewer private edit',
      });
      viewer.run(thirdLink.id);
      await viewer.idle();
      expect(viewer.state.get(thirdLink.id).lastError?.code).toBe(
        'VIEWER_READ_ONLY',
      );
      expect(third.catalog.getAsset(source.asset.id).note).toBe(
        'viewer private edit',
      );
      await one.removeMember(source.library.id, viewerId);
      viewer.run(thirdLink.id);
      await viewer.idle();
      expect(viewer.state.get(thirdLink.id).state).toBe('blocked');
      expect(third.catalog.listLibraries()).toHaveLength(1);
    } finally {
      await one.close();
      await two.close();
      await viewer.close();
      gateway.closeAllConnections();
      await new Promise<void>((resolve) => gateway.close(() => resolve()));
    }
  },
  120000,
);
configured(
  'rejects malicious graph and corrupt cloud bytes without advancing the complete-commit cursor or changing existing local work',
  async () => {
    const config = JSON.parse(
      await readFile(process.env.CURA_SYNC_TEST_STATUS!, 'utf8'),
    ) as { API_URL: string; ANON_KEY: string };
    if (!['127.0.0.1', 'localhost'].includes(new URL(config.API_URL).hostname))
      throw new Error('Only disposable loopback Supabase is permitted');
    const environment = {
      CURA_SUPABASE_URL: config.API_URL,
      CURA_SUPABASE_ANON_KEY: config.ANON_KEY,
    };
    const account = {
      email: `cura-integrity-${randomUUID()}@example.test`,
      password: randomBytes(24).toString('hex'),
    };
    const signup = await fetch(`${config.API_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: config.ANON_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(account),
    });
    expect(signup.status).toBe(200);
    const source = await graphFixture(),
      target = await fixture(false);
    const owner = new SyncService(source.db, source.paths, {
        environment,
        intervalMs: 0,
      }),
      receiver = new SyncService(target.db, target.paths, {
        environment,
        intervalMs: 0,
      });
    try {
      await owner.initialize();
      await receiver.initialize();
      await owner.signIn(account);
      await receiver.signIn(account);
      const first = await owner.publish({ libraryId: source.library.id });
      await owner.idle();
      expect(owner.state.get(first.id).lastError).toBeNull();
      const second = await receiver.join({ libraryId: source.library.id });
      await receiver.idle();
      expect(receiver.state.get(second.id).lastError).toBeNull();
      const original = readPortableGraph(target.db, source.library.id),
        before = receiver.state.get(second.id).cursor;
      const cloud = (owner as unknown as { cloud: SyncCloud }).cloud;
      const baseline = owner.state
        .baselines(first.id)
        .find((record) => record.kind === 'board')!;
      const corrupt = structuredClone(baseline.payload!);
      if (corrupt.kind !== 'board') throw new Error('Fixture board missing');
      corrupt.data.slots.find(
        (slot) => slot.currentPin,
      )!.currentPin!.versionId = randomUUID();
      const bad = await cloud.commit(source.library.id, randomUUID(), [
        {
          kind: 'board',
          key: corrupt.id,
          expectedRevision: baseline.revision,
          payload: corrupt,
          tombstone: false,
        },
      ]);
      receiver.run(second.id);
      await receiver.idle();
      expect(receiver.state.get(second.id).lastError?.code).toBe(
        'SYNC_INVALID_GRAPH',
      );
      expect(receiver.state.get(second.id).cursor).toBe(before);
      expect(readPortableGraph(target.db, source.library.id)).toEqual(original);
      await cloud.commit(source.library.id, randomUUID(), [
        {
          kind: 'board',
          key: corrupt.id,
          expectedRevision: bad.changes[0]!.revision,
          payload: baseline.payload,
          tombstone: false,
        },
      ]);
      receiver.run(second.id);
      await receiver.idle();
      expect(receiver.state.get(second.id).lastError).toBeNull();
      const repairedCursor = receiver.state.get(second.id).cursor;
      const newFile = await source.file(
        `malicious cloud bytes ${randomUUID()}`,
      );
      source.catalog.replaceAsset(source.asset.id, newFile, 'new.png');
      const upload = await owner.auth
        .client()
        .storage.from('cura-sync-objects')
        .upload(
          `${source.library.id}/${newFile.hash}`,
          Buffer.alloc(newFile.size, 1),
          { upsert: false, contentType: 'application/octet-stream' },
        );
      expect(upload.error).toBeNull();
      const graph = readPortableGraph(source.db, source.library.id);
      await cloud.commit(
        source.library.id,
        randomUUID(),
        owner.state.changes(first.id, graph.records),
      );
      receiver.run(second.id);
      await receiver.idle();
      expect(receiver.state.get(second.id).lastError?.code).toBe(
        'SYNC_BLOB_INTEGRITY',
      );
      expect(receiver.state.get(second.id).cursor).toBe(repairedCursor);
      expect(readPortableGraph(target.db, source.library.id)).toEqual(original);
      await expect(
        stat(join(target.paths.data, 'objects', newFile.hash)),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      for (const file of original.files)
        expect(await readFile(file.source)).toEqual(
          await readFile(
            source.catalog.getVersionFile(
              source.catalog
                .listVersions(source.asset.id)
                .find((v) => v.hash === file.hash)!.id,
            ).snapshotPath,
          ),
        );
    } finally {
      await owner.close();
      await receiver.close();
    }
  },
  120000,
);
