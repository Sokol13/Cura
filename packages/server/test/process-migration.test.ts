import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

test('legacy fork clones share a deterministic identity while retaining their different edited metadata', () => {
  const database = new Database(':memory:');
  try {
    database.exec(`CREATE TABLE libraries(id TEXT PRIMARY KEY);
      CREATE TABLE assets(id TEXT PRIMARY KEY,library_id TEXT,payload TEXT,created_at TEXT,updated_at TEXT);
      CREATE TABLE asset_versions(id TEXT PRIMARY KEY,asset_id TEXT,payload TEXT,created_at TEXT,updated_at TEXT);`);
    const library = '00000000-0000-4000-8000-000000000001';
    const first = '00000000-0000-4000-8000-000000000011';
    const clone = '00000000-0000-4000-8000-000000000012';
    const v1 = '00000000-0000-4000-8000-000000000021';
    const vClone = '00000000-0000-4000-8000-000000000022';
    const v2 = '00000000-0000-4000-8000-000000000023';
    const date = '2026-01-01T00:00:00.000Z';
    const later = '2026-01-02T00:00:00.000Z';
    database.prepare('INSERT INTO libraries VALUES (?)').run(library);
    database
      .prepare('INSERT INTO assets VALUES (?,?,?,?,?)')
      .run(
        first,
        library,
        JSON.stringify({ currentVersionId: v1, finalized: true }),
        date,
        later,
      );
    database
      .prepare('INSERT INTO assets VALUES (?,?,?,?,?)')
      .run(
        clone,
        library,
        JSON.stringify({ currentVersionId: v2, finalized: false }),
        date,
        later,
      );
    const insert = database.prepare(
      'INSERT INTO asset_versions VALUES (?,?,?,?,?)',
    );
    insert.run(
      v1,
      first,
      JSON.stringify({
        hash: 'same-output',
        source: 'ComfyUI',
        model: 'manually-corrected-original',
        seed: '18446744073709551615',
        params: { exact: '18446744073709551615' },
      }),
      date,
      date,
    );
    insert.run(
      vClone,
      clone,
      JSON.stringify({
        hash: 'same-output',
        source: 'clone-edited-source',
        model: 'different-clone-label',
      }),
      date,
      later,
    );
    insert.run(
      v2,
      clone,
      JSON.stringify({
        hash: 'new-output',
        source: 'sd-webui',
        model: 'new-model',
      }),
      later,
      later,
    );
    database.exec(
      readFileSync(
        new URL('../drizzle/0003_process.sql', import.meta.url),
        'utf8',
      ),
    );
    const generations = database
      .prepare('SELECT * FROM recorded_generations ORDER BY id')
      .all() as Record<string, unknown>[];
    expect(generations).toHaveLength(2);
    expect(generations[0]).toMatchObject({
      id: v1,
      source: 'ComfyUI',
      model: 'manually-corrected-original',
      created_at: date,
      updated_at: later,
      origin: 'legacy-backfill',
    });
    const payload = (id: string) =>
      JSON.parse(
        (
          database
            .prepare('SELECT payload FROM asset_versions WHERE id=?')
            .get(id) as { payload: string }
        ).payload,
      ) as Record<string, unknown>;
    expect(payload(v1).generationId).toBe(v1);
    expect(payload(vClone).generationId).toBe(v1);
    expect(payload(v2).generationId).toBe(v2);
    expect(payload(v1).seed).toBe('18446744073709551615');
    expect(payload(v1).params).toEqual({ exact: '18446744073709551615' });
    expect(payload(vClone).model).toBe('different-clone-label');
    expect(
      database
        .prepare(
          'SELECT owner_kind,owner_id,asset_id,version_id FROM final_selections',
        )
        .all(),
    ).toEqual([
      {
        owner_kind: 'manual',
        owner_id: first,
        asset_id: first,
        version_id: v1,
      },
    ]);
  } finally {
    database.close();
  }
});
