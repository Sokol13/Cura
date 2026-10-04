import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/database.js';
import { appMetadata } from '../src/schema.js';
import { resolveUserPaths } from '../src/paths.js';

const cleanups: Array<() => Promise<unknown> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});

describe('SQLite infrastructure', () => {
  it('migrates a native SQLite database and preserves data when reopened', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cura-db-'));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const paths = resolveUserPaths({
      CURA_DATA_DIR: join(root, 'data'),
      CURA_CACHE_DIR: join(root, 'cache'),
      CURA_LOG_DIR: join(root, 'logs'),
    });
    const first = openDatabase(paths);
    try {
      first.database
        .insert(appMetadata)
        .values({ key: 'test', value: 'kept' })
        .run();
      expect(first.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(
        first.sqlite
          .prepare('SELECT count(*) AS count FROM __drizzle_migrations')
          .get(),
      ).toEqual({ count: 2 });
    } finally {
      first.close();
    }

    const reopened = openDatabase(paths);
    cleanups.push(() => reopened.close());
    expect(reopened.database.select().from(appMetadata).all()).toEqual([
      {
        key: 'test',
        value: 'kept',
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2} /),
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2} /),
      },
    ]);
    expect(
      reopened.sqlite
        .prepare('SELECT count(*) AS count FROM __drizzle_migrations')
        .get(),
    ).toEqual({ count: 2 });
    expect((await stat(join(paths.data, 'cura.sqlite'))).isFile()).toBe(true);
    for (const directory of Object.values(paths)) {
      expect((await stat(directory)).isDirectory()).toBe(true);
    }
  });

  it('uses operating-system user directories by default', () => {
    const paths = resolveUserPaths({});
    for (const path of Object.values(paths)) {
      expect(path).toContain('Cura');
      expect(path.startsWith(process.cwd())).toBe(false);
    }
  });
});
