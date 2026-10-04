import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readPortableGraph, semanticHash } from '../src/sync/portable.js';
import { replayPortableGraph } from '../src/sync/replay.js';
import { fixture, graphFixture } from './sync-test-fixtures.js';
it('captures full portable metadata and ignores preview-only timestamps without leaking paths', async () => {
  const f = await graphFixture(),
    before = readPortableGraph(f.db, f.library.id);
  expect(JSON.stringify(before.records)).not.toContain(f.dir);
  expect(JSON.stringify(before.records)).not.toContain('relativePath');
  expect(before.records.map((record) => record.kind)).toEqual(
    expect.arrayContaining([
      'automationJob',
      'automationProposal',
      'automationChange',
      'archiveRule',
      'scriptBreakdown',
      'settingDocument',
    ]),
  );
  expect(before.records.some((record) => record.id === f.pendingJob.id)).toBe(
    false,
  );
  expect(
    before.records.find((record) => record.kind === 'archiveRule')!.data
      .lastJobId,
  ).toBeNull();
  expect(
    before.records.filter((r) => r.kind === 'asset')[0]!.data.versions[0]!.seed,
  ).toBe('18446744073709551615');
  f.catalog.updateVersionPreview(f.pin.versionId, '/private/preview.webp');
  const after = readPortableGraph(f.db, f.library.id);
  expect(after.records.map(semanticHash)).toEqual(
    before.records.map(semanticHash),
  );
});
it('replays complete identities and historical pins into an unwatched managed root without activity or source aliases', async () => {
  const source = await graphFixture(),
    target = await fixture(false),
    graph = readPortableGraph(source.db, source.library.id);
  for (const file of graph.files) {
    await mkdir(join(target.paths.data, 'objects'), { recursive: true });
    await writeFile(
      join(target.paths.data, 'objects', file.hash),
      readFileSync(file.source),
    );
  }
  replayPortableGraph(
    target.db,
    target.paths,
    source.library.id,
    graph.records,
  );
  expect(readPortableGraph(target.db, source.library.id).records).toEqual(
    graph.records,
  );
  expect(
    target.db.sqlite.prepare('SELECT count(*) count FROM asset_sources').get(),
  ).toEqual({ count: 0 });
  expect(
    target.db.sqlite.prepare('SELECT managed FROM library_roots').get(),
  ).toEqual({ managed: 1 });
  const paths = source.db.sqlite.prepare('SELECT * FROM asset_sources').all();
  replayPortableGraph(
    source.db,
    source.paths,
    source.library.id,
    graph.records,
  );
  expect(source.db.sqlite.prepare('SELECT * FROM asset_sources').all()).toEqual(
    paths,
  );
});
it('rejects corrupt historical ownership and rolls back every record', async () => {
  const source = await graphFixture(),
    target = await fixture(false),
    graph = readPortableGraph(source.db, source.library.id);
  const board = graph.records.find((r) => r.kind === 'board')!;
  board.data.slots[0]!.currentPin = {
    assetId: source.asset.id,
    versionId: randomUUID(),
  };
  expect(() =>
    replayPortableGraph(
      target.db,
      target.paths,
      source.library.id,
      graph.records,
    ),
  ).toThrow();
  expect(target.catalog.listLibraries()).toEqual([]);
});
it('does not let incoming terminal history take over an active device-local job identity', async () => {
  const f = await graphFixture(),
    graph = readPortableGraph(f.db, f.library.id);
  const terminal = structuredClone(
    graph.records.find((record) => record.kind === 'automationJob')!,
  );
  terminal.id = f.pendingJob.id;
  terminal.data.id = f.pendingJob.id;
  terminal.data.results = [];
  graph.records.push(terminal);
  expect(() =>
    replayPortableGraph(f.db, f.paths, f.library.id, graph.records),
  ).toThrow(/active/);
  const row = f.db.sqlite
    .prepare('SELECT payload FROM automation_jobs WHERE id=?')
    .get(f.pendingJob.id) as { payload: string };
  expect(JSON.parse(row.payload).status).toBe('running');
});
