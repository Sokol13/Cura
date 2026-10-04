import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDatabase } from '../src/database.js';

it('migrates every board domain table with timestamps and foreign keys', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cura-board-migrate-'));
  const db = openDatabase({
    data: join(dir, 'data'),
    cache: join(dir, 'cache'),
    log: join(dir, 'log'),
  });
  try {
    const tables = db.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    for (const table of [
      'boards',
      'board_items',
      'board_edges',
      'slot_templates',
      'slots',
      'slot_revisions',
    ]) {
      expect(tables.map((row) => row.name)).toContain(table);
      const fields = db.sqlite
        .prepare(`PRAGMA table_info(${table})`)
        .all() as Array<{ name: string }>;
      expect(fields.map((row) => row.name)).toEqual(
        expect.arrayContaining([
          'id',
          'library_id',
          'created_at',
          'updated_at',
        ]),
      );
      expect(
        db.sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all().length,
      ).toBeGreaterThan(0);
    }
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
