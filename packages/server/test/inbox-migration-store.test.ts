import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CatalogStore, type IngestedFile } from '../src/catalog-store.js';
import { openDatabase } from '../src/database.js';
import { resolveUserPaths } from '../src/paths.js';

const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});

const observed = {
  hash: 'a'.repeat(64),
  dev: '1',
  ino: '42',
  size: '42',
  mtimeNs: '1791100000000000000',
  ctimeNs: '1791100000000000001',
};
const target = { ...observed, ino: '43' };
const processed = (hash: string): IngestedFile => ({
  hash,
  size: 42,
  type: 'image/png',
  width: 3,
  height: 2,
  colors: [],
  phash: '0'.repeat(16),
  exif: {},
  generation: {
    prompt: 'Retained prompt',
    negativePrompt: '',
    model: '',
    seed: '',
    source: '',
    params: {},
  },
  snapshotPath: `/snapshots/${hash}`,
  thumbnailPath: `/thumbnails/${hash}.webp`,
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'cura-inbox-journal-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const paths = resolveUserPaths({
    CURA_DATA_DIR: join(directory, 'data'),
    CURA_CACHE_DIR: join(directory, 'cache'),
    CURA_LOG_DIR: join(directory, 'logs'),
  });
  let db = openDatabase(paths);
  cleanups.push(() => db.close());
  let store = new CatalogStore(db);
  const library = store.createLibrary({ name: 'Inbox test' });
  const root = store.addRoot(library.id, join(directory, 'Inbox'), 'inbox');
  const relativePath = `${randomUUID()}/角色-é.png`;
  const actualRelativePath = relativePath.normalize('NFD');
  const asset = store.ingest({
    libraryId: library.id,
    rootId: root.id,
    relativePath,
    actualRelativePath,
    processed: processed(observed.hash),
  }).asset;
  const source = store.getSource(root.id, relativePath)!;
  return {
    get db() {
      return db;
    },
    get store() {
      return store;
    },
    library,
    root,
    asset,
    source,
    reopen() {
      db.close();
      db = openDatabase(paths);
      store = new CatalogStore(db);
    },
  };
}

describe('Inbox migration journal', () => {
  it('changes only source and primary asset locators after a manual V2 replacement', async () => {
    const f = await fixture();
    f.store.replaceAsset(
      f.asset.id,
      processed('b'.repeat(64)),
      'Manual V2.png',
    );
    f.store.updateAsset(f.asset.id, {
      displayName: 'Chosen display name',
      note: 'Keep me',
    });
    const read = (table: string) =>
      f.db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
    const beforeAsset = read('assets')[0] as Record<string, unknown>;
    const beforeSource = read('asset_sources')[0];
    const preserved = Object.fromEntries(
      ['asset_versions', 'activity', 'libraries', 'library_roots'].map(
        (table) => [table, read(table)],
      ),
    );
    const journal = f.store.inboxMigrations;
    expect(journal).toBeDefined();
    const oldSearch = f.source.relativePath.split('/')[0]!.split('-')[0]!;
    expect(f.store.listAssets(f.library.id, { q: oldSearch }).total).toBe(1);
    const next = '2026-10-05/角色-é.png';
    const plan = journal.plan(f.source.id, next, observed);
    expect(plan).toMatchObject({
      state: 'planned',
      oldRelativePath: f.source.relativePath,
      oldActualRelativePath: f.source.actualRelativePath,
      lastHash: observed.hash,
      sourceCreatedAt: f.source.createdAt,
      sourceUpdatedAt: f.source.updatedAt,
      observed,
      target: null,
    });
    expect(() => journal.relocate(plan.id)).toThrow();
    journal.update(plan.id, { state: 'published', target });
    expect(journal.relocate(plan.id).state).toBe('relocated');
    expect(read('asset_sources')).toEqual([
      {
        ...(beforeSource as object),
        relative_path: next,
        actual_relative_path: next,
      },
    ]);
    expect(read('assets')).toEqual([
      {
        ...beforeAsset,
        relative_path: next,
        search_text: expect.any(String),
        payload: JSON.stringify({
          ...JSON.parse(String(beforeAsset.payload)),
          relativePath: next,
        }),
      },
    ]);
    for (const [table, rows] of Object.entries(preserved))
      expect(read(table)).toEqual(rows);
    expect(f.store.listAssets(f.library.id, { q: oldSearch }).total).toBe(0);
    expect(f.store.listAssets(f.library.id, { q: '2026' }).total).toBe(1);
    expect(f.store.getAsset(f.asset.id)).toMatchObject({
      id: f.asset.id,
      name: 'Manual V2.png',
      displayName: 'Chosen display name',
      hash: 'b'.repeat(64),
      relativePath: next,
    });
    expect(journal.complete(plan.id).state).toBe('complete');
    expect(journal.pending(f.root.id)).toEqual([]);
    expect(journal.sources(f.root.id)).toEqual([]);
  });

  it('resumes each durable state across reopen and treats relocation/completion as idempotent', async () => {
    const f = await fixture();
    const plan = f.store.inboxMigrations.plan(
      f.source.id,
      '2026-10-05/角色-é.png',
      observed,
    );
    f.reopen();
    expect(f.store.inboxMigrations.pending(f.root.id)).toEqual([plan]);
    const reserved = f.store.inboxMigrations.update(plan.id, {
      state: 'reserved',
      target: { ...target, hash: '0'.repeat(64), size: '0' },
    });
    f.reopen();
    expect(f.store.inboxMigrations.pending(f.root.id)).toEqual([reserved]);
    expect(() =>
      f.store.inboxMigrations.retarget(plan.id, '2026-10-05/other.png'),
    ).toThrow();
    f.store.inboxMigrations.update(plan.id, { state: 'published', target });
    f.reopen();
    const relocated = f.store.inboxMigrations.relocate(plan.id);
    f.reopen();
    expect(f.store.inboxMigrations.relocate(plan.id)).toEqual(relocated);
    expect(f.store.inboxMigrations.pending(f.root.id)).toEqual([relocated]);
    const complete = f.store.inboxMigrations.complete(plan.id);
    f.reopen();
    expect(f.store.inboxMigrations.complete(plan.id)).toEqual(complete);
    expect(f.store.inboxMigrations.pending(f.root.id)).toEqual([]);
    expect(f.db.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('rejects a source hash change after publication without modifying either locator', async () => {
    const f = await fixture();
    const plan = f.store.inboxMigrations.plan(
      f.source.id,
      '2026-10-05/角色-é.png',
      observed,
    );
    f.store.inboxMigrations.update(plan.id, { state: 'published', target });
    f.db.sqlite
      .prepare('UPDATE asset_sources SET last_hash=? WHERE id=?')
      .run('c'.repeat(64), f.source.id);
    expect(() => f.store.inboxMigrations.relocate(plan.id)).toThrow(/changed/i);
    expect(f.store.getSource(f.root.id, f.source.relativePath)?.lastHash).toBe(
      'c'.repeat(64),
    );
    expect(f.store.getAsset(f.asset.id).relativePath).toBe(
      f.source.relativePath,
    );
    expect(f.store.inboxMigrations.pending(f.root.id)[0]?.state).toBe(
      'published',
    );
  });

  it('leaves a different primary alias untouched while relocating an unavailable source', async () => {
    const f = await fixture();
    const root = f.store.addRoot(f.library.id, '/reference');
    f.store.ingest({
      libraryId: f.library.id,
      rootId: root.id,
      relativePath: 'alias.png',
      actualRelativePath: 'alias.png',
      processed: processed(observed.hash),
    });
    f.store.markSourceMissing(f.root.id, f.source.relativePath);
    const before = f.store.getAsset(f.asset.id);
    const source = f.store.getSource(f.root.id, f.source.relativePath)!;
    const plan = f.store.inboxMigrations.plan(
      f.source.id,
      '2026-10-05/角色-é.png',
      observed,
    );
    f.store.inboxMigrations.update(plan.id, { state: 'published', target });
    f.store.inboxMigrations.relocate(plan.id);
    expect(f.store.getAsset(f.asset.id)).toEqual(before);
    expect(f.store.getSource(f.root.id, plan.newRelativePath)).toEqual({
      ...source,
      relativePath: plan.newRelativePath,
      actualRelativePath: plan.newRelativePath,
    });
  });

  it('enumerates only legacy UUID sources and rejects unsafe, removed, managed and cross-library records', async () => {
    const f = await fixture();
    expect(f.store.inboxMigrations.sources(f.root.id)).toEqual([
      { ...f.source, libraryId: f.library.id },
    ]);
    for (const relativePath of [
      '2026-10-05/already.png',
      'other/file.png',
      `${randomUUID()}/nested/file.png`,
    ]) {
      f.store.ingest({
        libraryId: f.library.id,
        rootId: f.root.id,
        relativePath,
        actualRelativePath: relativePath,
        processed: processed(randomUUID()),
      });
    }
    expect(f.store.inboxMigrations.sources(f.root.id)).toHaveLength(1);
    for (const targetPath of [
      '../outside.png',
      '2026-02-30/file.png',
      '2026-10-05/nested/file.png',
      `${randomUUID()}/file.png`,
    ]) {
      expect(() =>
        f.store.inboxMigrations.plan(f.source.id, targetPath, observed),
      ).toThrow();
    }
    for (const update of [
      "kind='reference'",
      'managed=1',
      "removed_at='2026-10-05T00:00:00Z'",
    ]) {
      f.db.sqlite
        .prepare(`UPDATE library_roots SET ${update} WHERE id=?`)
        .run(f.root.id);
      expect(() =>
        f.store.inboxMigrations.plan(
          f.source.id,
          '2026-10-05/file.png',
          observed,
        ),
      ).toThrow();
      expect(f.store.inboxMigrations.sources(f.root.id)).toEqual([]);
      f.db.sqlite
        .prepare(
          "UPDATE library_roots SET kind='inbox',managed=0,removed_at=NULL WHERE id=?",
        )
        .run(f.root.id);
    }
    const other = f.store.createLibrary({ name: 'Other' });
    f.db.sqlite
      .prepare('UPDATE assets SET library_id=? WHERE id=?')
      .run(other.id, f.asset.id);
    expect(() =>
      f.store.inboxMigrations.plan(
        f.source.id,
        '2026-10-05/file.png',
        observed,
      ),
    ).toThrow();
    expect(f.store.inboxMigrations.sources(f.root.id)).toEqual([]);
  });

  it('reserves one plan per source and retargets only before publication', async () => {
    const f = await fixture();
    const journal = f.store.inboxMigrations;
    const plan = journal.plan(f.source.id, '2026-10-05/file.png', observed);
    expect(
      journal.plan(f.source.id, '2026-10-06/ignored.png', observed),
    ).toEqual(plan);
    const retargeted = journal.retarget(plan.id, '2026-10-05/file (2).png');
    expect(retargeted).toMatchObject({
      id: plan.id,
      newRelativePath: '2026-10-05/file (2).png',
      observed,
    });
    expect(() => journal.complete(plan.id)).toThrow();
    expect(() => journal.update(plan.id, { state: 'published' })).toThrow();
    journal.update(plan.id, { state: 'published', target });
    expect(() =>
      journal.retarget(plan.id, '2026-10-05/file (3).png'),
    ).toThrow();
    expect(() => journal.update(plan.id, { state: 'planned' })).toThrow();
  });

  it.each(['complete', 'rollback'] as const)(
    '%s recovers after a same-hash Windows rescan changes path spelling and timestamps',
    async (action) => {
      const f = await fixture();
      f.db.sqlite
        .prepare('UPDATE asset_sources SET updated_at=? WHERE id=?')
        .run('2020-01-01T00:00:00.000Z', f.source.id);
      const journal = f.store.inboxMigrations;
      const plan = journal.plan(f.source.id, '2026-10-05/角色-é.png', observed);
      journal.update(plan.id, { state: 'published', target });
      journal.relocate(plan.id);
      f.store.ingest({
        libraryId: f.library.id,
        rootId: f.root.id,
        relativePath: plan.newRelativePath,
        actualRelativePath: plan.newRelativePath
          .replaceAll('/', '\\')
          .normalize('NFD'),
        processed: processed(observed.hash),
      });
      const current = f.store.getSource(f.root.id, plan.newRelativePath)!;
      expect(current.updatedAt).not.toBe(plan.sourceUpdatedAt);
      expect(journal[action](plan.id).state).toBe(
        action === 'complete' ? 'complete' : 'reserved',
      );
      expect(
        f.store.getSource(
          f.root.id,
          action === 'complete' ? plan.newRelativePath : plan.oldRelativePath,
        ),
      ).toEqual(
        action === 'complete'
          ? current
          : {
              ...current,
              relativePath: plan.oldRelativePath,
              actualRelativePath: plan.oldActualRelativePath,
            },
      );
    },
  );

  it('preserves offline state while completing a migration after root revival', async () => {
    const f = await fixture();
    const journal = f.store.inboxMigrations;
    const plan = journal.plan(f.source.id, '2026-10-05/file.png', observed);
    journal.update(plan.id, { state: 'published', target });
    journal.relocate(plan.id);
    f.store.deleteRoot(f.root.id, 'offline');
    expect(() => journal.complete(plan.id)).toThrow();
    expect(f.store.addRoot(f.library.id, f.root.path, 'inbox').id).toBe(
      f.root.id,
    );
    const current = f.store.getSource(f.root.id, plan.newRelativePath)!;
    expect(current.available).toBe(false);
    expect(journal.complete(plan.id).state).toBe('complete');
    expect(f.store.getSource(f.root.id, plan.newRelativePath)).toEqual(current);
  });

  it('rolls the transaction back when a catalog alias already owns the destination', async () => {
    const f = await fixture();
    const journal = f.store.inboxMigrations;
    const next = '2026-10-05/file.png';
    f.store.ingest({
      libraryId: f.library.id,
      rootId: f.root.id,
      relativePath: next,
      actualRelativePath: next,
      processed: processed('b'.repeat(64)),
    });
    const read = () =>
      ['assets', 'asset_sources', 'asset_versions', 'asset_fts'].map((table) =>
        f.db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      );
    const before = read();
    const plan = journal.plan(f.source.id, next, observed);
    journal.update(plan.id, { state: 'published', target });
    expect(() => journal.relocate(plan.id)).toThrow();
    expect(read()).toEqual(before);
    expect(journal.get(plan.id).state).toBe('published');
  });

  it('rolls back only locators and refreshes changed source observations without losing the owned target', async () => {
    const f = await fixture();
    const journal = f.store.inboxMigrations;
    const beforeAsset = f.store.getAsset(f.asset.id);
    const plan = journal.plan(f.source.id, '2026-10-05/file.png', observed);
    journal.update(plan.id, { state: 'published', target });
    journal.relocate(plan.id);
    const reverted = journal.rollback(plan.id);
    expect(reverted).toMatchObject({ state: 'reserved', target });
    expect(f.store.getAsset(f.asset.id)).toEqual(beforeAsset);
    expect(
      f.store.listAssets(f.library.id, {
        q: f.source.relativePath.split('/')[0]!.split('-')[0]!,
      }).total,
    ).toBe(1);
    expect(f.store.listAssets(f.library.id, { q: '2026' }).total).toBe(0);
    expect(f.store.getSource(f.root.id, f.source.relativePath)).toEqual(
      f.source,
    );
    const changed = {
      ...observed,
      hash: 'c'.repeat(64),
      mtimeNs: '1791100000000000002',
    };
    f.db.sqlite
      .prepare('UPDATE asset_sources SET last_hash=? WHERE id=?')
      .run(changed.hash, f.source.id);
    expect(journal.reobserve(plan.id, changed)).toMatchObject({
      state: 'reserved',
      observed: changed,
      lastHash: changed.hash,
      target,
    });
    journal.update(plan.id, {
      state: 'published',
      target: { ...changed, ino: target.ino },
    });
    expect(journal.reobserve(plan.id, changed).state).toBe('reserved');
    journal.update(plan.id, {
      state: 'published',
      target: { ...changed, ino: target.ino },
    });
    journal.relocate(plan.id);
    f.db.sqlite
      .prepare('UPDATE asset_sources SET last_hash=? WHERE id=?')
      .run('d'.repeat(64), f.source.id);
    expect(() => journal.rollback(plan.id)).toThrow(/changed/i);
    expect(f.store.getSource(f.root.id, plan.newRelativePath)).toBeDefined();
  });
});
