import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { openDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { MediaService } from '../src/media/service.js';
import { GenerationService } from '../src/process/service.js';
import { CatalogStore } from '../src/catalog-store.js';

it('stops generation before media workers and releases the database last', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cura-close-'));
  const paths = {
    data: join(dir, 'data'),
    cache: join(dir, 'cache'),
    log: join(dir, 'log'),
  };
  const db = openDatabase(paths);
  const order: string[] = [];
  const original = MediaService.prototype.close;
  const spy = vi
    .spyOn(MediaService.prototype, 'close')
    .mockImplementation(async function (this: MediaService) {
      expect(db.sqlite.open).toBe(true);
      await original.call(this);
      order.push('media');
    });
  const originalGenerationClose = GenerationService.prototype.close;
  const generationSpy = vi
    .spyOn(GenerationService.prototype, 'close')
    .mockImplementation(async function (this: GenerationService) {
      expect(db.sqlite.open).toBe(true);
      await originalGenerationClose.call(this);
      order.push('generation');
    });
  try {
    const app = await createApp({
      staticRoot: false,
      database: db,
      paths,
      onClose: () => {
        order.push('database');
        db.close();
      },
    });
    await app.ready();
    const library = new CatalogStore(db).createLibrary({
      name: 'Closing jobs',
    });
    const queued = await app.inject({
      method: 'POST',
      url: `/api/libraries/${library.id}/generations`,
      payload: { prompt: 'Shutdown while generating', count: 4 },
    });
    expect(queued.statusCode).toBe(201);
    await app.close();
    expect(order).toEqual(['generation', 'media', 'database']);
    expect(db.sqlite.open).toBe(false);
  } finally {
    spy.mockRestore();
    generationSpy.mockRestore();
    if (db.sqlite.open) db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
