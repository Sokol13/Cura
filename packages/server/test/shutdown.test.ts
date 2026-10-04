import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { openDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { MediaService } from '../src/media/service.js';

it('awaits worker and watcher shutdown before releasing the database', async () => {
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
    await app.close();
    expect(order).toEqual(['media', 'database']);
    expect(db.sqlite.open).toBe(false);
  } finally {
    spy.mockRestore();
    if (db.sqlite.open) db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
