import { randomUUID } from 'node:crypto';
import { setFinalSelection } from '../src/process/final-selections.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type AppDatabase } from '../src/database.js';
import { resolveUserPaths } from '../src/paths.js';
import { CatalogStore, type IngestedFile } from '../src/catalog-store.js';

const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});
const file = (
  hash: string,
  overrides: Partial<IngestedFile> = {},
): IngestedFile => ({
  hash,
  size: 42,
  type: 'image/png',
  width: 300,
  height: 200,
  colors: ['#ff0000'],
  phash: '0000000000000000',
  exif: {},
  generation: {
    prompt: 'forest sunlight',
    negativePrompt: 'bad',
    model: 'flux',
    seed: '18446744073709551615',
    source: 'ComfyUI',
    params: {},
  },
  snapshotPath: `/snapshot/${hash}`,
  thumbnailPath: `/thumb/${hash}.webp`,
  ...overrides,
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'cura-catalog-'));
  const paths = resolveUserPaths({
    CURA_DATA_DIR: join(dir, 'data'),
    CURA_CACHE_DIR: join(dir, 'cache'),
    CURA_LOG_DIR: join(dir, 'logs'),
  });
  let db: AppDatabase = openDatabase(paths);
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  cleanups.push(() => db.close());
  let store = new CatalogStore(db);
  const library = store.createLibrary({ name: '作品' });
  const root = store.addRoot(library.id, '/pictures');
  return {
    get store() {
      return store;
    },
    get db() {
      return db;
    },
    library,
    root,
    reopen() {
      db.close();
      db = openDatabase(paths);
      store = new CatalogStore(db);
    },
    ingest(name: string, hash: string, overrides: Partial<IngestedFile> = {}) {
      return store.ingest({
        libraryId: library.id,
        rootId: root.id,
        relativePath: name,
        actualRelativePath: name,
        processed: file(hash, overrides),
      });
    },
  };
}

describe('catalog persistence and lineage', () => {
  it('does not archive duplicate bytes when the original catches up to manual replacement', async () => {
    const f = await fixture();
    const a = f.ingest('a.png', 'a').asset;
    f.store.replaceAsset(a.id, file('b'), 'replacement.png');
    const caughtUp = f.ingest('a.png', 'b');
    expect(caughtUp.changed).toBe(false);
    expect(f.store.listVersions(a.id)).toHaveLength(2);
    expect(f.store.getSource(f.root.id, 'a.png')?.lastHash).toBe('b');
  });

  it('reports persisted catalog statistics', async () => {
    const f = await fixture();
    f.ingest('a.png', 'a');
    expect(f.store.stats()).toMatchObject({
      libraries: 1,
      roots: 1,
      assets: 1,
      versions: 1,
      sources: 1,
    });
  });
  it('migrates and preserves libraries, roots, exact seeds, versions and settings on reopen', async () => {
    const f = await fixture();
    const result = f.ingest('森林.png', 'a');
    f.store.updateSettings({ language: 'en', activeLibraryId: f.library.id });
    f.reopen();
    expect(f.store.listLibraries()).toEqual([f.library]);
    expect(f.store.listRoots(f.library.id)).toEqual([f.root]);
    expect(f.store.getAsset(result.asset.id).seed).toBe('18446744073709551615');
    expect(f.store.listVersions(result.asset.id)).toHaveLength(1);
    expect(f.store.getSettings()).toMatchObject({
      language: 'en',
      activeLibraryId: f.library.id,
    });
    expect(JSON.stringify(result.asset)).not.toContain('/snapshot/');
    expect(JSON.stringify(f.store.listVersions(result.asset.id))).not.toContain(
      '/thumb/',
    );
  });
  it('normalizes accented Chinese paths, merges content aliases and retains immutable prior versions', async () => {
    const f = await fixture();
    const first = f.ingest('角色-é.png', 'a');
    expect(f.ingest('角色-é.png'.normalize('NFD'), 'a')).toMatchObject({
      changed: false,
      asset: { id: first.asset.id },
    });
    expect(f.ingest('copy.png', 'a').asset.id).toBe(first.asset.id);
    const changed = f.ingest('角色-é.png'.normalize('NFD'), 'b');
    expect(changed.asset.id).not.toBe(first.asset.id);
    expect(f.store.listVersions(changed.asset.id).map((v) => v.hash)).toEqual([
      'b',
      'a',
    ]);
    expect(f.ingest('copy.png', 'a').asset.hash).toBe('a');
    expect(f.ingest('角色-é.png', 'b').changed).toBe(false);
    expect(f.store.listAssets(f.library.id).total).toBe(2);
    const old = f.store.listVersions(changed.asset.id)[1]!;
    expect(f.store.getVersionFile(old.id).snapshotPath).toBe('/snapshot/a');
    const next = f.ingest('角色-é.png', 'c');
    expect(next.asset.id).toBe(changed.asset.id);
    expect(
      f.store.listVersions(changed.asset.id).map((v) => v.ordinal),
    ).toEqual([3, 2, 1]);
  });
  it('keeps manual replacement when an unchanged original is rescanned', async () => {
    const f = await fixture();
    const a = f.ingest('a.png', 'a').asset;
    const replacement = f.store.replaceAsset(a.id, file('b'), 'new.png');
    expect(replacement.hash).toBe('b');
    expect(f.ingest('a.png', 'a')).toMatchObject({
      changed: false,
      asset: { id: a.id, hash: 'b' },
    });
    expect(f.store.listVersions(a.id).map((v) => v.hash)).toEqual(['b', 'a']);
    expect(f.ingest('a.png', 'c').asset.hash).toBe('c');
  });
  it('preserves metadata and tags when duplicate aliases diverge and root unregisters', async () => {
    const f = await fixture();
    const first = f.ingest('one.png', 'a').asset;
    f.ingest('two.png', 'a');
    const tag = f.store.createTag(f.library.id, { name: '角色' });
    f.store.updateAsset(first.id, {
      rating: 4,
      note: 'approved',
      tagIds: [tag.id],
    });
    const fork = f.ingest('two.png', 'b').asset;
    expect(fork).toMatchObject({ rating: 4, note: 'approved', tags: [tag] });
    f.store.deleteRoot(f.root.id);
    expect(f.store.getAsset(fork.id).hash).toBe('b');
    expect(f.store.listVersions(first.id)).toHaveLength(1);
    expect(f.store.listRoots(f.library.id)).toEqual([]);
  });
});

describe('catalog organization and search', () => {
  it('updates FTS for editable metadata and tags, safely searches punctuation and short CJK', async () => {
    const f = await fixture();
    const a = f.ingest('美丽森林.png', 'a').asset;
    expect(f.store.listAssets(f.library.id, { q: '林' }).total).toBe(1);
    expect(f.store.listAssets(f.library.id, { q: '森林' }).total).toBe(1);
    expect(f.store.listAssets(f.library.id, { q: 'forest' }).total).toBe(1);
    expect(() =>
      f.store.listAssets(f.library.id, { q: '" * OR x:' }),
    ).not.toThrow();
    const tag = f.store.createTag(f.library.id, { name: 'hero' });
    f.store.updateAsset(a.id, {
      note: 'selected draft',
      prompt: 'ocean',
      model: 'sdxl',
      tagIds: [tag.id],
    });
    expect(f.store.listAssets(f.library.id, { q: 'forest' }).total).toBe(0);
    expect(f.store.listAssets(f.library.id, { q: '森林 selected' }).total).toBe(
      1,
    );
    expect(f.store.listAssets(f.library.id, { q: '森林 missing' }).total).toBe(
      0,
    );
    expect(f.store.listAssets(f.library.id, { q: 'hero' }).total).toBe(1);
    f.store.updateTag(tag.id, { name: 'protagonist' });
    expect(f.store.listAssets(f.library.id, { q: 'hero' }).total).toBe(0);
    expect(f.store.listAssets(f.library.id, { q: 'protagonist' }).total).toBe(
      1,
    );
    f.store.deleteTag(tag.id);
    expect(f.store.listAssets(f.library.id, { q: 'protagonist' }).total).toBe(
      0,
    );
  });
  it('combines filters, includes child folders, ranks true hash/color distance and caps pagination', async () => {
    const f = await fixture();
    const parent = f.store.createFolder(f.library.id, { name: 'parent' });
    const child = f.store.createFolder(f.library.id, {
      name: 'child',
      parentId: parent.id,
    });
    const tag = f.store.createTag(f.library.id, { name: 'hero' });
    const a = f.ingest('森林.png', 'a', { phash: '0000000000000000' }).asset;
    const b = f.ingest('森林-second.png', 'b', {
      phash: '8000000000000000',
      colors: ['#fe0000'],
    }).asset;
    f.ingest('other.png', 'c', {
      phash: '000000000000000f',
      colors: ['#0000ff'],
    });
    f.store.updateAsset(b.id, {
      rating: 5,
      folderId: child.id,
      tagIds: [tag.id],
    });
    const query = {
      q: '森林',
      folderId: parent.id,
      tagId: tag.id,
      rating: 5,
      type: 'image/png',
      color: '#ff0000',
      source: 'ComfyUI',
      after: '2000-01-01T00:00:00.000Z',
      before: '2100-01-01T00:00:00.000Z',
      minWidth: 300,
      minHeight: 200,
      maxWidth: 300,
      maxHeight: 200,
    };
    expect(
      f.store.listAssets(f.library.id, query).items.map((v) => v.id),
    ).toEqual([b.id]);
    for (const mismatch of [
      { q: 'missingword' },
      { rating: 4 },
      { type: 'image/jpeg' },
      { color: '#0000ff' },
      { source: 'SDWebUI' },
      { after: '2100-01-01T00:00:00.000Z' },
      { before: '2000-01-01T00:00:00.000Z' },
      { minWidth: 301 },
      { minHeight: 201 },
      { maxWidth: 299 },
      { maxHeight: 199 },
      { tagId: f.store.createTag(f.library.id, { name: 'unused' }).id },
      {
        folderId: f.store.createFolder(f.library.id, { name: 'unrelated' }).id,
      },
    ])
      expect(
        f.store.listAssets(f.library.id, { ...query, ...mismatch }).total,
      ).toBe(0);
    expect(
      f.store
        .listAssets(f.library.id, { similarTo: a.id })
        .items.map((v) => v.hash),
    ).toEqual(['a', 'b', 'c']);
    expect(
      f.store
        .listAssets(f.library.id, { color: '#ff0000' })
        .items.map((v) => v.hash),
    ).toEqual(['a', 'b']);
    expect(
      f.store.listAssets(f.library.id, { offset: 1, limit: 1 }).items,
    ).toHaveLength(1);
    expect(() => f.store.listAssets(f.library.id, { limit: 201 })).toThrow();
  });
  it('rejects cross-library batches atomically and prevents folder cycles', async () => {
    const f = await fixture();
    const a = f.ingest('a.png', 'a').asset;
    const other = f.store.createLibrary({ name: 'Other' });
    const otherRoot = f.store.addRoot(other.id, '/elsewhere');
    const b = f.store.ingest({
      libraryId: other.id,
      rootId: otherRoot.id,
      relativePath: 'b.png',
      actualRelativePath: 'b.png',
      processed: file('b'),
    }).asset;
    expect(() =>
      f.store.batchAssets(f.library.id, {
        assetIds: [a.id, b.id],
        patch: { rating: 5 },
      }),
    ).toThrow();
    expect(f.store.getAsset(a.id).rating).toBe(0);
    const parent = f.store.createFolder(f.library.id, { name: 'A' });
    const child = f.store.createFolder(f.library.id, {
      name: 'B',
      parentId: parent.id,
    });
    expect(() =>
      f.store.updateFolder(parent.id, { parentId: child.id }),
    ).toThrow();
    const foreign = f.store.createTag(other.id, { name: 'foreign' });
    expect(() => f.store.updateAsset(a.id, { tagIds: [foreign.id] })).toThrow();
    f.store.batchAssets(f.library.id, { assetIds: [a.id], action: 'trash' });
    expect(f.store.listAssets(f.library.id).total).toBe(0);
    expect(f.store.listAssets(f.library.id, { trash: true }).total).toBe(1);
    expect(f.store.getVersionFile(a.currentVersionId).snapshotPath).toBe(
      '/snapshot/a',
    );
    f.store.batchAssets(f.library.id, { assetIds: [a.id], action: 'restore' });
    expect(f.store.listAssets(f.library.id).total).toBe(1);
  });
  it('validates annotation ownership and persists groups, smart collections and folder changes', async () => {
    const f = await fixture();
    const a = f.ingest('a.png', 'a').asset;
    const b = f.ingest('b.png', 'b').asset;
    expect(() =>
      f.store.createAnnotation(a.id, {
        versionId: b.currentVersionId,
        x: 0.5,
        y: 0.5,
        text: 'wrong',
      }),
    ).toThrow();
    const annotation = f.store.createAnnotation(a.id, {
      versionId: a.currentVersionId,
      x: 0.5,
      y: 0.5,
      text: 'eye',
    });
    expect(f.store.listAnnotations(a.id, a.currentVersionId)).toEqual([
      annotation,
    ]);
    const group = f.store.createTagGroup(f.library.id, { name: 'style' });
    const tag = f.store.createTag(f.library.id, {
      name: 'anime',
      groupId: group.id,
    });
    f.store.deleteTagGroup(group.id);
    expect(f.store.listTags(f.library.id)[0]).toMatchObject({
      id: tag.id,
      groupId: null,
    });
    const collection = f.store.createCollection(f.library.id, {
      name: 'five',
      rules: { rating: 5 },
    });
    const folder = f.store.createFolder(f.library.id, { name: 'old' });
    f.store.updateAsset(a.id, { folderId: folder.id });
    f.store.deleteFolder(folder.id);
    expect(f.store.getAsset(a.id).folderId).toBeNull();
    f.reopen();
    expect(f.store.listCollections(f.library.id)).toEqual([collection]);
    expect(f.store.listAnnotations(a.id)).toEqual([annotation]);
    f.store.deleteAnnotation(annotation.id);
    expect(f.store.listAnnotations(a.id)).toEqual([]);
  });
  it(
    'searches one thousand assets under 200ms including one-character CJK',
    { timeout: 15_000 },
    async () => {
      const f = await fixture();
      // Fixture construction can exceed Vitest's default five seconds on CI.
      // Every measured query below still has its independent 200 ms limit.
      f.db.sqlite.transaction(() => {
        for (let i = 0; i < 1000; i++) f.ingest(`森林-${i}.png`, String(i));
      })();
      for (const query of [
        { q: '林' },
        { q: '森林' },
        { q: 'forest', rating: 0 },
        { color: '#ff0000' },
      ]) {
        const start = performance.now();
        const result = f.store.listAssets(f.library.id, query);
        const elapsed = performance.now() - start;
        expect(result.total).toBe(1000);
        expect(result.items.length).toBe(100);
        expect(elapsed).toBeLessThan(200);
      }
    },
  );
});

describe('catalog preview cache recovery', () => {
  it('enumerates every immutable version including trash and unregistered roots', async () => {
    const f = await fixture();
    const original = f.ingest('original.png', 'original').asset;
    const replacement = f.store.replaceAsset(
      original.id,
      file('replacement'),
      'replacement.png',
    );
    f.store.batchAssets(f.library.id, {
      assetIds: [original.id],
      action: 'trash',
    });
    f.store.deleteRoot(f.root.id);
    const library = f.store.createLibrary({ name: 'Second library' });
    const root = f.store.addRoot(library.id, '/other-pictures');
    const other = f.store.ingest({
      libraryId: library.id,
      rootId: root.id,
      relativePath: 'other.png',
      actualRelativePath: 'other.png',
      processed: file('other', { thumbnailPath: null }),
    }).asset;
    expect(f.store.listAllVersions()).toEqual(
      expect.arrayContaining([
        {
          id: original.currentVersionId,
          assetId: original.id,
          libraryId: f.library.id,
          snapshotPath: '/snapshot/original',
          thumbnailPath: '/thumb/original.webp',
          type: 'image/png',
          name: 'original.png',
        },
        {
          id: replacement.currentVersionId,
          assetId: original.id,
          libraryId: f.library.id,
          snapshotPath: '/snapshot/replacement',
          thumbnailPath: '/thumb/replacement.webp',
          type: 'image/png',
          name: 'replacement.png',
        },
        {
          id: other.currentVersionId,
          assetId: other.id,
          libraryId: library.id,
          snapshotPath: '/snapshot/other',
          thumbnailPath: null,
          type: 'image/png',
          name: 'other.png',
        },
      ]),
    );
    expect(f.store.listAllVersions()).toHaveLength(3);
  });

  it('persists preview relocation and clearing without changing immutable content or other versions', async () => {
    const f = await fixture();
    const asset = f.ingest('first.png', 'first').asset;
    const replacement = f.store.replaceAsset(
      asset.id,
      file('second'),
      'second.png',
    );
    f.store.batchAssets(f.library.id, {
      assetIds: [asset.id],
      action: 'trash',
    });
    f.store.deleteRoot(f.root.id);
    const original = f.store
      .listVersions(asset.id)
      .find((version) => version.id === asset.currentVersionId)!;
    const current = f.store.getAsset(asset.id);
    const unchanged = f.store.getVersionFile(replacement.currentVersionId);
    const changedAt = '2040-01-02T03:04:05.000Z';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(changedAt));
    try {
      f.store.updateVersionPreview(
        original.id,
        "/relocated-cache/preview'one.webp",
      );
      f.reopen();
      expect(f.store.getVersionFile(original.id)).toMatchObject({
        snapshotPath: '/snapshot/first',
        thumbnailPath: "/relocated-cache/preview'one.webp",
      });
      expect(
        f.store
          .listVersions(asset.id)
          .find((version) => version.id === original.id),
      ).toEqual({
        ...original,
        previewRevision: (original.previewRevision ?? 0) + 1,
        updatedAt: changedAt,
      });
      expect(f.store.getVersionFile(replacement.currentVersionId)).toEqual(
        unchanged,
      );
      expect(f.store.getAsset(asset.id)).toEqual(current);
      expect(JSON.stringify(f.store.listVersions(asset.id))).not.toContain(
        '/relocated-cache/',
      );
      f.store.updateVersionPreview(original.id, null);
      f.reopen();
      expect(f.store.getVersionFile(original.id).thumbnailPath).toBeNull();
      expect(() =>
        f.store.updateVersionPreview(crypto.randomUUID(), '/missing.webp'),
      ).toThrow('asset_versions record not found');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('source availability', () => {
  it('keeps one asset and its lineage when a source is renamed and then edited', async () => {
    const f = await fixture();
    const original = f.ingest('角色-é.png', 'a').asset;
    expect(
      f.store.markSourceMissing(f.root.id, '角色-é.png'.normalize('NFD')),
    ).toMatchObject({ id: original.id, missing: true });
    const renamed = f.ingest('renamed.png', 'a').asset;
    expect(renamed).toMatchObject({
      id: original.id,
      relativePath: 'renamed.png',
      name: 'renamed.png',
      missing: false,
    });
    expect(f.store.listVersions(original.id)).toHaveLength(1);
    expect(f.store.listVersions(original.id)[0]?.name).toBe('角色-é.png');
    expect(f.ingest('renamed.png', 'b').asset.id).toBe(original.id);
    expect(f.store.listAssets(f.library.id)).toMatchObject({
      total: 1,
      items: [{ id: original.id, missing: false }],
    });
    expect(
      f.store.listVersions(original.id).map((version) => version.hash),
    ).toEqual(['b', 'a']);
    expect(f.store.getSource(f.root.id, '角色-é.png')?.available).toBe(false);
  });

  it('ignores deleted duplicate aliases when the remaining original changes', async () => {
    const f = await fixture();
    const original = f.ingest('first.png', 'a').asset;
    f.ingest('duplicate.png', 'a');
    expect(f.store.markSourceMissing(f.root.id, 'first.png')).toMatchObject({
      id: original.id,
      relativePath: 'duplicate.png',
      missing: false,
    });
    expect(f.ingest('duplicate.png', 'b').asset.id).toBe(original.id);
    expect(f.store.listAssets(f.library.id).total).toBe(1);
    expect(f.store.getVersionFile(original.currentVersionId).snapshotPath).toBe(
      '/snapshot/a',
    );
    expect(f.store.markSourceMissing(f.root.id, 'unknown.png')).toBeNull();
    expect(f.store.markSourceMissing(f.root.id, 'first.png')).toBeNull();
  });

  it('reconciles missing sources transactionally and restores source availability on ingest', async () => {
    const f = await fixture();
    const first = f.ingest('first.png', 'a').asset;
    const second = f.ingest('角色-é.png', 'b').asset;
    expect(
      f.store.reconcileSources(f.root.id, ['角色-é.png'.normalize('NFD')]),
    ).toMatchObject([{ id: first.id, missing: true }]);
    expect(f.store.getAsset(second.id).missing).toBe(false);
    expect(
      f.store
        .listAssets(f.library.id)
        .items.find((asset) => asset.id === first.id)?.missing,
    ).toBe(true);
    expect(f.store.listAllVersions()).toHaveLength(2);
    expect(f.store.getVersionFile(first.currentVersionId).snapshotPath).toBe(
      '/snapshot/a',
    );
    f.reopen();
    expect(f.store.getAsset(first.id).missing).toBe(true);
    expect(f.ingest('first.png', 'a')).toMatchObject({
      changed: true,
      asset: { id: first.id, missing: false },
    });
    expect(f.store.listVersions(first.id)).toHaveLength(1);
    expect(() => f.store.reconcileSources(f.root.id, ['../invalid'])).toThrow();
    expect(f.store.getAsset(first.id).missing).toBe(false);
  });

  it('marks unregistered roots unavailable while available aliases in another root retain the asset', async () => {
    const f = await fixture();
    const original = f.ingest('first.png', 'a').asset;
    const otherRoot = f.store.addRoot(f.library.id, '/other-root');
    f.store.ingest({
      libraryId: f.library.id,
      rootId: otherRoot.id,
      relativePath: 'second.png',
      actualRelativePath: 'second.png',
      processed: file('a'),
    });
    f.store.deleteRoot(f.root.id);
    expect(f.store.getSource(f.root.id, 'first.png')?.available).toBe(false);
    expect(f.store.getAsset(original.id)).toMatchObject({
      rootId: otherRoot.id,
      relativePath: 'second.png',
      missing: false,
    });
    const edited = f.store.ingest({
      libraryId: f.library.id,
      rootId: otherRoot.id,
      relativePath: 'second.png',
      actualRelativePath: 'second.png',
      processed: file('b'),
    }).asset;
    expect(edited.id).toBe(original.id);
    f.store.deleteRoot(otherRoot.id);
    expect(f.store.getAsset(original.id).missing).toBe(true);
    expect(f.store.listVersions(original.id)).toHaveLength(2);
  });
});

describe('reviewed catalog editing and similarity', () => {
  it('retains manual generation corrections in the archived version after replacement', async () => {
    const f = await fixture();
    const asset = f.ingest('first.png', 'a', {
      generation: {
        ...file('a').generation,
        params: { raw: 'original PNG parameters' },
      },
    }).asset;
    f.store.updateAsset(asset.id, {
      prompt: 'corrected prompt',
      negativePrompt: 'corrected negative',
      model: 'corrected model',
      source: 'corrected source',
      seed: '18446744073709551614',
      rating: 5,
      note: 'global note',
    });
    f.store.replaceAsset(asset.id, file('b'), 'replacement.png');
    const archived = f.store
      .listVersions(asset.id)
      .find((version) => version.id === asset.currentVersionId)!;
    expect(archived).toMatchObject({
      prompt: 'corrected prompt',
      negativePrompt: 'corrected negative',
      model: 'corrected model',
      source: 'corrected source',
      seed: '18446744073709551614',
      params: { raw: 'original PNG parameters' },
    });
    expect(archived).not.toHaveProperty('rating');
    expect(archived).not.toHaveProperty('note');
    expect(f.store.getAsset(asset.id)).toMatchObject({
      rating: 5,
      note: 'global note',
    });
    f.store.updateAsset(asset.id, {
      prompt: 'current only',
      params: { edited: true },
    });
    expect(f.store.listVersions(asset.id)[0]).toMatchObject({
      prompt: 'current only',
      params: { edited: true },
    });
    expect(
      f.store
        .listVersions(asset.id)
        .find((version) => version.id === archived.id)?.prompt,
    ).toBe('corrected prompt');
  });

  it('rejects unsupported similarity references and excludes candidates without a valid perceptual hash', async () => {
    const f = await fixture();
    const reference = f.ingest('reference.png', 'reference').asset;
    const unsupported = f.ingest('unsupported.bin', 'unsupported', {
      phash: '',
      type: 'application/octet-stream',
    }).asset;
    const malformed = f.ingest('malformed.png', 'malformed', {
      phash: '0123456789abcdeg',
    }).asset;
    const similar = f.ingest('similar.png', 'similar', {
      phash: '0000000000000001',
    }).asset;
    for (const asset of [unsupported, malformed])
      expect(() =>
        f.store.listAssets(f.library.id, { similarTo: asset.id }),
      ).toThrowError(
        expect.objectContaining({
          message: 'Similarity unavailable for this format',
          code: 'SIMILARITY_UNAVAILABLE',
          statusCode: 400,
        }),
      );
    expect(
      f.store
        .listAssets(f.library.id, { similarTo: reference.id })
        .items.map((asset) => asset.id),
    ).toEqual([reference.id, similar.id]);
  });

  it('edits annotation text and position while retaining its original version ownership', async () => {
    const f = await fixture();
    const asset = f.ingest('first.png', 'a').asset;
    const replacement = f.store.replaceAsset(
      asset.id,
      file('b'),
      'replacement.png',
    );
    const annotation = f.store.createAnnotation(asset.id, {
      versionId: asset.currentVersionId,
      x: 0.2,
      y: 0.3,
      text: 'original note',
    });
    const updated = f.store.updateAnnotation(annotation.id, {
      text: 'corrected note',
    });
    expect(updated).toMatchObject({
      id: annotation.id,
      assetId: asset.id,
      versionId: asset.currentVersionId,
      x: 0.2,
      y: 0.3,
      text: 'corrected note',
      createdAt: annotation.createdAt,
    });
    expect(
      f.store.updateAnnotation(annotation.id, { x: 0, y: 1 }),
    ).toMatchObject({ text: 'corrected note', x: 0, y: 1 });
    expect(() =>
      f.store.updateAnnotation(annotation.id, {
        versionId: replacement.currentVersionId,
      } as unknown as { text: string }),
    ).toThrow();
    expect(() => f.store.updateAnnotation(annotation.id, { x: 1.1 })).toThrow();
    expect(() =>
      f.store.updateAnnotation(annotation.id, { text: '  ' }),
    ).toThrow();
    f.reopen();
    expect(
      f.store.listAnnotations(asset.id, asset.currentVersionId),
    ).toMatchObject([
      {
        id: annotation.id,
        versionId: asset.currentVersionId,
        text: 'corrected note',
        x: 0,
        y: 1,
      },
    ]);
    expect(
      f.store.listAnnotations(asset.id, replacement.currentVersionId),
    ).toEqual([]);
  });
});

describe('P2 catalog metadata and managed roots', () => {
  it('changes searchable display metadata while keeping source and version names exact', async () => {
    const f = await fixture();
    const a = f.ingest('original.png', 'display').asset;
    const changed = f.store.updateAsset(a.id, {
      displayName: 'Hero-e\u0301.png',
    });
    expect(changed).toMatchObject({
      name: 'original.png',
      relativePath: 'original.png',
      displayName: 'Hero-é.png',
      archivedAt: null,
    });
    expect(
      f.store.listAssets(f.library.id, { q: 'Hero' }).items.map((x) => x.id),
    ).toEqual([a.id]);
    f.store.replaceAsset(a.id, file('replacement'), 'new.jpg');
    expect(f.store.getAsset(a.id).displayName).toBe('Hero-é.png');
    expect(f.store.listVersions(a.id).map((v) => v.name)).toEqual([
      'new.jpg',
      'original.png',
    ]);
    f.store.updateAsset(a.id, { displayName: null });
    expect(f.store.listAssets(f.library.id, { q: 'Hero' }).total).toBe(0);
  });

  it('archives atomically with any historical final owner protected and keeps Trash independent', async () => {
    const f = await fixture();
    const a = f.ingest('a.png', 'archive-a').asset;
    const b = f.ingest('b.png', 'archive-b').asset;
    setFinalSelection(
      f.db,
      { libraryId: f.library.id, ownerKind: 'slot', ownerId: randomUUID() },
      { assetId: b.id, versionId: b.currentVersionId },
    );
    f.store.replaceAsset(b.id, file('next-b'), 'next-b.png');
    expect(f.store.getAsset(b.id).finalized).toBe(false);
    expect(() =>
      f.store.batchAssets(f.library.id, {
        assetIds: [a.id, b.id],
        action: 'archive',
      }),
    ).toThrow(/final/i);
    expect(f.store.getAsset(a.id).archivedAt).toBeNull();
    f.store.batchAssets(f.library.id, { assetIds: [a.id], action: 'archive' });
    expect(f.store.listAssets(f.library.id).items.map((x) => x.id)).toEqual([
      b.id,
    ]);
    expect(
      f.store
        .listAssets(f.library.id, { archived: true })
        .items.map((x) => x.id),
    ).toEqual([a.id]);
    f.store.batchAssets(f.library.id, { assetIds: [a.id], action: 'trash' });
    expect(
      f.store.listAssets(f.library.id, { trash: true }).items.map((x) => x.id),
    ).toEqual([a.id]);
    f.store.batchAssets(f.library.id, { assetIds: [a.id], action: 'restore' });
    f.store.batchAssets(f.library.id, {
      assetIds: [a.id],
      action: 'unarchive',
    });
    expect(f.store.getAsset(a.id).archivedAt).toBeNull();
  });

  it('restores an archived asset when a historical version becomes final', async () => {
    const f = await fixture();
    const a = f.ingest('old.png', 'old-archive').asset;
    f.store.replaceAsset(a.id, file('new-archive'), 'new.png');
    f.store.updateAsset(a.id, { archivedAt: new Date().toISOString() });
    setFinalSelection(
      f.db,
      { libraryId: f.library.id, ownerKind: 'slot', ownerId: randomUUID() },
      { assetId: a.id, versionId: a.currentVersionId },
    );
    expect(f.store.getAsset(a.id)).toMatchObject({
      archivedAt: null,
      finalized: false,
    });
  });

  it('hides managed roots from registrations and considers retained incoming assets available', async () => {
    const f = await fixture();
    const a = f.ingest('incoming.png', 'managed').asset;
    f.db.sqlite
      .prepare('UPDATE library_roots SET managed=1 WHERE id=?')
      .run(f.root.id);
    f.db.sqlite.prepare('DELETE FROM asset_sources WHERE asset_id=?').run(a.id);
    expect(f.store.listRoots(f.library.id)).toEqual([]);
    expect(() => f.store.getRoot(f.root.id)).toThrow();
    expect(() => f.store.deleteRoot(f.root.id)).toThrow();
    expect(f.store.getAsset(a.id).missing).toBe(false);
    expect(
      f.db.sqlite
        .prepare('SELECT removed_at FROM library_roots WHERE id=?')
        .get(f.root.id),
    ).toEqual({ removed_at: null });
  });

  it('refreshes replayed search fields without changing identity, timestamps or activity', async () => {
    const f = await fixture();
    const a = f.ingest('source.png', 'index').asset;
    const count = f.db.sqlite
      .prepare('SELECT count(*) AS n FROM activity')
      .get();
    f.db.sqlite
      .prepare(
        "UPDATE assets SET payload=json_set(payload,'$.displayName','Synced hero.png') WHERE id=?",
      )
      .run(a.id);
    f.store.refreshAssetSearch([a.id]);
    expect(
      f.store.listAssets(f.library.id, { q: 'Synced' }).items.map((x) => x.id),
    ).toEqual([a.id]);
    expect(f.store.getAsset(a.id)).toMatchObject({
      id: a.id,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    });
    expect(
      f.db.sqlite.prepare('SELECT count(*) AS n FROM activity').get(),
    ).toEqual(count);
  });
});
