import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { expect, test, vi } from 'vitest';
import { GenerationJobSchema } from '@cura/shared';
import { openDatabase } from '../src/database.js';
import { resolveUserPaths } from '../src/paths.js';
import { CatalogStore } from '../src/catalog-store.js';
import { MediaService } from '../src/media/service.js';
import { registerProcessRoutes } from '../src/process/routes.js';

test('real generation routes ingest mock bytes through media and report failure/cancellation honestly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cura-process-service-'));
  const paths = resolveUserPaths({
    CURA_DATA_DIR: join(directory, 'data'),
    CURA_CACHE_DIR: join(directory, 'cache'),
    CURA_LOG_DIR: join(directory, 'logs'),
  });
  const database = openDatabase(paths);
  const catalog = new CatalogStore(database);
  const media = new MediaService(catalog, paths);
  const app = Fastify();
  registerProcessRoutes(app, database, catalog, media);
  const library = catalog.createLibrary({ name: 'Mock provider' });
  try {
    const create = await app.inject({
      method: 'POST',
      url: `/api/libraries/${library.id}/generations`,
      payload: {
        prompt: 'An offline forest',
        seed: '18446744073709551615',
        width: 128,
        height: 96,
      },
    });
    expect(create.statusCode).toBe(201);
    const job = GenerationJobSchema.parse(create.json());
    await vi.waitFor(
      async () => {
        const result = GenerationJobSchema.parse(
          (await app.inject(`/api/generations/${job.id}`)).json(),
        );
        expect(result.status).toBe('completed');
      },
      { timeout: 10000, interval: 20 },
    );
    const complete = GenerationJobSchema.parse(
      (await app.inject(`/api/generations/${job.id}`)).json(),
    );
    expect(complete.assetIds).toHaveLength(1);
    const asset = catalog.getAsset(complete.assetIds[0]!);
    expect(asset).toMatchObject({
      source: 'mock',
      prompt: 'An offline forest',
      seed: '18446744073709551615',
      width: 128,
      height: 96,
    });
    expect(asset.params.raw).toBeDefined();
    expect(
      catalog.getVersionFile(asset.currentVersionId).snapshotPath,
    ).toContain(paths.data);
    const failed = GenerationJobSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/libraries/${library.id}/generations`,
          payload: { prompt: 'Failure demonstration', mockOutcome: 'fail' },
        })
      ).json(),
    );
    await vi.waitFor(
      async () => {
        expect(
          GenerationJobSchema.parse(
            (await app.inject(`/api/generations/${failed.id}`)).json(),
          ),
        ).toMatchObject({ status: 'failed', assetIds: [] });
      },
      { timeout: 5000 },
    );
    const cancelled = GenerationJobSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/libraries/${library.id}/generations`,
          payload: { prompt: 'Cancellation demonstration', count: 4 },
        })
      ).json(),
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/generations/${cancelled.id}/cancel`,
        })
      ).statusCode,
    ).toBe(200);
    await vi.waitFor(async () => {
      expect(
        GenerationJobSchema.parse(
          (await app.inject(`/api/generations/${cancelled.id}`)).json(),
        ),
      ).toMatchObject({ status: 'cancelled', assetIds: [] });
    });
  } finally {
    await app.close();
    await media.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
