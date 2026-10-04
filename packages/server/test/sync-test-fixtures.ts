import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { openDatabase } from '../src/database.js';
import { CatalogStore, type IngestedFile } from '../src/catalog-store.js';
import { BoardStore } from '../src/boards/store.js';
import { BrandStore } from '../src/brands/store.js';
import { AutomationRepository } from '../src/automation/repository.js';
import { ArchiveRuleSchema } from '@cura/shared';

const cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});
export async function fixture(seed = true) {
  const dir = await mkdtemp(join(tmpdir(), 'cura-sync-')),
    paths = {
      data: join(dir, 'data'),
      cache: join(dir, 'cache'),
      log: join(dir, 'log'),
    };
  const db = openDatabase(paths),
    catalog = new CatalogStore(db),
    boards = new BoardStore(db),
    brands = new BrandStore(db);
  cleanup.push(
    () => rm(dir, { recursive: true, force: true }),
    () => db.close(),
  );
  const library = seed ? catalog.createLibrary({ name: '共享创作' }) : null;
  const root = library
    ? catalog.addRoot(library.id, join(dir, 'originals'))
    : null;
  for (const migration of ['0006_automation', '0007_sync']) {
    const table = migration.startsWith('0006')
      ? 'automation_jobs'
      : 'sync_links';
    if (
      !db.sqlite
        .prepare('SELECT name FROM sqlite_master WHERE name=?')
        .get(table)
    )
      db.sqlite.exec(
        readFileSync(
          new URL(`../drizzle/${migration}.sql`, import.meta.url),
          'utf8',
        ),
      );
  }
  const file = async (text: string): Promise<IngestedFile> => {
    const bytes = Buffer.from(text),
      hash = createHash('sha256').update(bytes).digest('hex');
    const snapshotPath = join(paths.data, 'objects', hash);
    await mkdir(join(paths.data, 'objects'), { recursive: true });
    await writeFile(snapshotPath, bytes);
    return {
      hash,
      size: bytes.length,
      type: 'image/png',
      width: 300,
      height: 200,
      colors: ['#ff0000'],
      phash: '0000000000000000',
      exif: { description: '原始' },
      generation: {
        prompt: 'forest',
        negativePrompt: 'noise',
        model: '模型',
        seed: '18446744073709551615',
        source: 'ComfyUI',
        params: { libraryId: 'authored-json-is-not-a-relation' },
      },
      snapshotPath,
      thumbnailPath: null,
    };
  };
  return { dir, paths, db, catalog, boards, brands, library, root, file };
}
export async function graphFixture() {
  const f = await fixture(),
    library = f.library!,
    root = f.root!;
  const processed = await f.file('v1'),
    asset = f.catalog.ingest({
      libraryId: library.id,
      rootId: root.id,
      relativePath: '中文-é.png',
      actualRelativePath: '中文-é.png',
      processed,
    }).asset;
  const pin = { assetId: asset.id, versionId: asset.currentVersionId };
  const tag = f.catalog.createTag(library.id, { name: '主角' });
  f.catalog.updateAsset(asset.id, { tagIds: [tag.id], note: '笔记' });
  f.catalog.createAnnotation(asset.id, {
    versionId: pin.versionId,
    x: 0.2,
    y: 0.3,
    text: '旧版',
  });
  f.catalog.replaceAsset(asset.id, await f.file('v2'), 'new.png');
  const template = f.boards.listTemplates(library.id)[0]!;
  const board = f.boards.createBoard(library.id, {
    name: '角色',
    templateId: template.id,
  });
  f.boards.assignSlot(board.slots[0]!.id, { expectedRevision: 0, pin });
  const brand = f.brands.createBrand(library.id, { name: '品牌' });
  f.brands.saveBrand(brand.id, {
    expectedRevision: 0,
    name: brand.name,
    guidelines: '# 品牌',
    colors: [{ name: 'red', hex: '#ff0000' }],
    fonts: [],
    logos: [{ name: '历史', pin }],
  });
  const repo = new AutomationRepository(f.db),
    date = '2026-01-02T03:04:05.000Z';
  const identity = () => ({
    id: randomUUID(),
    libraryId: library.id,
    createdAt: date,
    updatedAt: date,
  });
  const provenance = {
    providerId: 'metadata-rules',
    kind: 'metadata-rules' as const,
    mode: 'rules' as const,
    model: null,
    rawText: 'historical model response',
    derivation: 'rules-v1',
    inputKind: 'metadata' as const,
    sourceHash: processed.hash,
  };
  const job = repo.put('automation_jobs', {
    ...identity(),
    kind: 'analysis',
    providerId: 'metadata-rules',
    status: 'completed',
    pins: [pin],
    total: 1,
    processed: 1,
    results: [],
    errorCode: null,
    ruleId: null,
    scriptId: null,
  });
  const pendingJob = repo.put('automation_jobs', {
    ...job,
    ...identity(),
    status: 'running',
  });
  const proposalId = randomUUID(),
    changeId = randomUUID();
  repo.put('automation_proposals', {
    ...identity(),
    id: proposalId,
    jobId: job.id,
    ...pin,
    sourceName: 'original.png',
    sourceHash: processed.hash,
    caption: '建议',
    provenance,
    changeIds: [changeId],
  });
  repo.put('automation_changes', {
    ...identity(),
    id: changeId,
    proposalId,
    ...pin,
    field: 'displayName',
    beforeValue: null,
    afterValue: '审定名字',
    suggestedTagNames: [],
    beforeTagLabels: [],
    afterTagLabels: [],
    status: 'undone',
    appliedAt: date,
    undoneAt: date,
  });
  repo.put('automation_jobs', {
    ...job,
    results: [{ ...pin, proposalId, errorCode: null }],
  });
  repo.put(
    'archive_rules',
    ArchiveRuleSchema.parse({
      ...identity(),
      name: 'Old drafts',
      enabled: false,
      filters: {
        olderThanDays: 30,
        folderId: randomUUID(),
        tagIds: [randomUUID()],
      },
      revision: 3,
      lastJobId: pendingJob.id,
    }),
  );
  const entity = {
    id: randomUUID(),
    kind: 'character' as const,
    name: 'ALICE',
    notes: 'Keep costume',
    references: [{ startLine: 1, endLine: 1, excerpt: 'ALICE' }],
  };
  const script = repo.put('script_breakdowns', {
    ...identity(),
    title: 'Original script',
    sourcePin: pin,
    sourceHash: processed.hash,
    lineCount: 1,
    revision: 2,
    entities: [entity],
    provenance: { ...provenance, kind: 'structured-script', inputKind: 'text' },
  });
  const version = f.catalog
    .listVersions(asset.id)
    .find((v) => v.id === pin.versionId)!;
  repo.put('setting_documents', {
    ...identity(),
    title: 'Character setting',
    kind: 'character',
    language: 'zh-CN',
    revision: 4,
    markdown: '# Hand-edited setting',
    sources: [
      {
        ...pin,
        hash: version.hash,
        name: version.name,
        note: 'Historical note',
        prompt: version.prompt,
        negativePrompt: version.negativePrompt,
        model: version.model,
        source: version.source,
        seed: version.seed,
        width: version.width,
        height: version.height,
        tags: ['主角'],
      },
    ],
    scriptId: script.id,
    entities: [entity],
    provenance: 'metadata-document-v1',
  });
  return { ...f, library, root, asset, pin, pendingJob };
}
