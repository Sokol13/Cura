import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import pino from 'pino';
import { unzipSync, strFromU8 } from 'fflate';
import { openDatabase } from '../src/database.js';
import { CatalogStore } from '../src/catalog-store.js';
import { createApp } from '../src/app.js';

it('retains startup root failures in diagnostics without exposing source paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cura-diagnostics-'));
  const paths = {
    data: join(dir, 'data'),
    cache: join(dir, 'cache'),
    log: join(dir, 'log'),
  };
  const db = openDatabase(paths);
  const store = new CatalogStore(db);
  const library = store.createLibrary({ name: 'Private workspace' });
  const root = store.addRoot(
    library.id,
    join(dir, 'missing-private-originals'),
  );
  const destination = pino.destination({
    dest: join(paths.log, 'cura.log'),
    sync: true,
  });
  const logger = pino({ level: 'error' }, destination);
  const app = await createApp({
    database: db,
    paths,
    staticRoot: false,
    loggerInstance: logger,
  });
  try {
    await app.ready();
    const response = await app.inject({
      url: '/api/diagnostics',
      headers: { host: 'localhost' },
    });
    expect(response.statusCode).toBe(200);
    const zip = unzipSync(response.rawPayload);
    const text = strFromU8(zip['logs.json']!);
    expect(text).not.toContain(dir);
    const entries: unknown = JSON.parse(text);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'media',
          code: 'ENOENT',
          rootId: root.id,
        }),
      ]),
    );
  } finally {
    await app.close();
    db.close();
    destination.end();
    await rm(dir, { recursive: true, force: true });
  }
});
