import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import {
  SyncSignInSchema,
  SyncLinkPatchSchema,
  SyncStatusSchema,
} from '../../shared/src/sync.js';

it('validates auth and patch inputs without defaulting unrelated fields or accepting secrets in status', () => {
  expect(
    SyncSignInSchema.parse({ email: 'owner@example.test', password: 'secret' }),
  ).toEqual({ email: 'owner@example.test', password: 'secret' });
  expect(
    SyncSignInSchema.safeParse({ email: 'broken', password: '' }).success,
  ).toBe(false);
  expect(SyncLinkPatchSchema.parse({ paused: true })).toEqual({ paused: true });
  const local = {
    configured: false,
    auth: 'unconfigured',
    account: null,
    links: [],
    error: null,
  };
  expect(SyncStatusSchema.parse(local)).toEqual(local);
  expect(
    SyncStatusSchema.safeParse({ ...local, accessToken: 'secret' }).success,
  ).toBe(false);
});

it('adds local sync state without changing existing sources and enforces one managed root', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(
      'CREATE TABLE libraries (id TEXT PRIMARY KEY); CREATE TABLE library_roots (id TEXT PRIMARY KEY, library_id TEXT NOT NULL REFERENCES libraries(id), path TEXT, kind TEXT, removed_at TEXT, created_at TEXT, updated_at TEXT);',
    );
    const libraryId = randomUUID(),
      rootId = randomUUID();
    db.prepare('INSERT INTO libraries VALUES (?)').run(libraryId);
    db.prepare('INSERT INTO library_roots VALUES (?,?,?,?,?,?,?)').run(
      rootId,
      libraryId,
      '/original',
      'reference',
      null,
      'before',
      'before',
    );
    db.exec(
      readFileSync(
        new URL('../drizzle/0007_sync.sql', import.meta.url),
        'utf8',
      ),
    );
    expect(
      db
        .prepare('SELECT managed,path,created_at FROM library_roots WHERE id=?')
        .get(rootId),
    ).toEqual({ managed: 0, path: '/original', created_at: 'before' });
    const insert = db.prepare(
      'INSERT INTO library_roots (id,library_id,managed) VALUES (?,?,1)',
    );
    insert.run(randomUUID(), libraryId);
    expect(() => insert.run(randomUUID(), libraryId)).toThrow(/UNIQUE/);
    for (const table of [
      'sync_links',
      'sync_baselines',
      'sync_outbox',
      'sync_staged_commits',
      'sync_conflicts',
    ]) {
      const fields = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
      }>;
      expect(fields.map((field) => field.name)).toEqual(
        expect.arrayContaining(['id', 'created_at', 'updated_at']),
      );
    }
  } finally {
    db.close();
  }
});
