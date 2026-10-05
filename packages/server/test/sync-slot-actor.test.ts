import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type * as S from '@cura/shared';
import { mergeGraphs } from '../src/sync/merge.js';
import { readPortableGraph, semanticHash } from '../src/sync/portable.js';
import { replayPortableGraph } from '../src/sync/replay.js';
import { validateGraph } from '../src/sync/validate.js';
import { fixture, graphFixture } from './sync-test-fixtures.js';

const account = {
  kind: 'account' as const,
  id: 'b6000000-0000-4000-8000-000000000001',
  email: 'artist@example.test',
};
const local = { kind: 'local' as const };
const system = { kind: 'system' as const, reason: 'sync-resolution' as const };
const boardRecord = (records: S.PortableRecord[]) =>
  records.find((record) => record.kind === 'board')!;
const setActor = (revision: S.SlotRevision, actor?: S.SlotActor) => {
  if (actor === undefined) delete revision.actor;
  else revision.actor = actor;
};

it.each([
  ['changed account', account, { ...account, email: 'forged@example.test' }],
  ['removed account', account, undefined],
  ['invented legacy actor', undefined, local],
] as const)(
  'rejects %s on the same revision identity during merge',
  async (_, before, after) => {
    const f = await graphFixture();
    const base = readPortableGraph(f.db, f.library.id).records;
    setActor(boardRecord(base).data.revisions[0]!, before);
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    setActor(boardRecord(theirs).data.revisions[0]!, after);

    expect(() =>
      mergeGraphs(f.library.id, randomUUID(), randomUUID(), base, ours, theirs),
    ).toThrow(/immutable.*actor/i);
  },
);

it('rejects coordinated attribution changes against the immutable merge base', async () => {
  const f = await graphFixture();
  const base = readPortableGraph(f.db, f.library.id).records;
  setActor(boardRecord(base).data.revisions[0]!, account);
  const changed = structuredClone(base);
  setActor(boardRecord(changed).data.revisions[0]!, local);

  expect(() =>
    mergeGraphs(
      f.library.id,
      randomUUID(),
      randomUUID(),
      base,
      changed,
      structuredClone(changed),
    ),
  ).toThrow(/immutable.*actor/i);
});

it('rejects conflicting actors for a new shared revision rather than splicing account fields', async () => {
  const f = await graphFixture();
  const base = readPortableGraph(f.db, f.library.id).records;
  const ours = structuredClone(base);
  const theirs = structuredClone(base);
  const own = boardRecord(ours);
  const incoming = boardRecord(theirs);
  const revision = {
    ...own.data.revisions[0]!,
    id: randomUUID(),
    ordinal: 2,
    actor: account,
  };
  own.data.revisions.push(revision);
  incoming.data.revisions.push({
    ...revision,
    actor: { ...account, id: randomUUID(), email: 'other@example.test' },
  });
  own.data.slots.find((slot) => slot.id === revision.slotId)!.revision = 2;
  incoming.data.slots.find((slot) => slot.id === revision.slotId)!.revision = 2;

  expect(() =>
    mergeGraphs(f.library.id, randomUUID(), randomUUID(), base, ours, theirs),
  ).toThrow(/immutable.*actor/i);
});

it('retains attributed history through ordinal rebasing and identifies synthetic resolutions as system work', async () => {
  const f = await graphFixture();
  const base = readPortableGraph(f.db, f.library.id).records;
  const ours = structuredClone(base);
  const theirs = structuredClone(base);
  const own = boardRecord(ours);
  const incoming = boardRecord(theirs);
  const previous = own.data.revisions[0]!;
  const currentPin = {
    assetId: f.asset.id,
    versionId: f.catalog.getAsset(f.asset.id).currentVersionId,
  };
  const ownSlot = own.data.slots.find((slot) => slot.id === previous.slotId)!;
  const incomingSlot = incoming.data.slots.find(
    (slot) => slot.id === previous.slotId,
  )!;
  ownSlot.currentPin = currentPin;
  ownSlot.revision = 2;
  incomingSlot.currentPin = null;
  incomingSlot.revision = 2;
  own.data.finalSelections[0] = {
    ...own.data.finalSelections[0]!,
    ...currentPin,
  };
  incoming.data.finalSelections = [];
  const ownRevision = {
    ...previous,
    id: randomUUID(),
    ordinal: 2,
    pin: currentPin,
    actor: account,
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
  };
  const incomingRevision = {
    ...previous,
    id: randomUUID(),
    ordinal: 2,
    pin: null,
    actor: local,
    createdAt: '2027-01-02T00:00:00.000Z',
    updatedAt: '2027-01-02T00:00:00.000Z',
  };
  own.data.revisions.push(ownRevision);
  incoming.data.revisions.push(incomingRevision);
  const linkId = randomUUID();
  const operationId = randomUUID();
  const merged = mergeGraphs(
    f.library.id,
    linkId,
    operationId,
    base,
    ours,
    theirs,
  );
  const history = boardRecord(merged.records).data.revisions;
  expect(history.find((revision) => revision.id === ownRevision.id)).toEqual(
    ownRevision,
  );
  expect(
    history.find((revision) => revision.id === incomingRevision.id),
  ).toEqual({ ...incomingRevision, ordinal: 3 });
  expect(history.find((revision) => revision.ordinal === 4)).toMatchObject({
    pin: currentPin,
    actor: system,
  });
  expect(
    merged.conflicts.flatMap((conflict) => conflict.ordinalRemaps),
  ).toEqual(
    expect.arrayContaining([
      { kind: 'slotRevision', id: incomingRevision.id, from: 2, to: 3 },
    ]),
  );
  expect(
    mergeGraphs(f.library.id, linkId, operationId, base, ours, theirs),
  ).toEqual(merged);
});

it('preserves every recorded actor and absent legacy attribution through export, merge, and repeated replay', async () => {
  const source = await graphFixture();
  const target = await fixture(false);
  const slot = source.boards
    .exportLibrary(source.library.id)
    .slots.find((value) => value.revision === 1)!;
  for (let revision = 1; revision < 5; revision++)
    source.boards.assignSlot(slot.id, {
      expectedRevision: revision,
      pin: revision % 2 === 0 ? source.pin : null,
    });
  const actors = [local, account, { ...account, email: null }, system];
  for (let ordinal = 1; ordinal <= 5; ordinal++)
    source.db.sqlite
      .prepare(
        'UPDATE slot_revisions SET actor_json=? WHERE slot_id=? AND ordinal=?',
      )
      .run(
        ordinal <= actors.length ? JSON.stringify(actors[ordinal - 1]) : null,
        slot.id,
        ordinal,
      );
  const graph = readPortableGraph(source.db, source.library.id);
  const history = [...boardRecord(graph.records).data.revisions].sort(
    (a, b) => a.ordinal - b.ordinal,
  );
  for (const [index, actor] of actors.entries())
    expect(history[index]).toMatchObject({ actor });
  expect(history[4]).not.toHaveProperty('actor');
  const merged = mergeGraphs(
    source.library.id,
    randomUUID(),
    randomUUID(),
    graph.records,
    structuredClone(graph.records),
    structuredClone(graph.records),
  );
  expect(merged.records).toEqual(graph.records);
  for (const file of graph.files) {
    await mkdir(join(target.paths.data, 'objects'), { recursive: true });
    await writeFile(
      join(target.paths.data, 'objects', file.hash),
      readFileSync(file.source),
    );
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    replayPortableGraph(
      target.db,
      target.paths,
      source.library.id,
      merged.records,
    );
    const replayed = readPortableGraph(target.db, source.library.id).records;
    expect(replayed).toEqual(graph.records);
    expect(semanticHash(replayed)).toBe(semanticHash(graph.records));
    expect(
      target.db.sqlite
        .prepare('SELECT actor_json FROM slot_revisions WHERE id=?')
        .get(history[4]!.id),
    ).toEqual({ actor_json: null });
  }
});

it.each([
  ['changes an existing account', account, { ...account, id: randomUUID() }],
  ['removes existing attribution', account, undefined],
  ['invents attribution for legacy history', undefined, local],
] as const)(
  'rejects replay that %s without changing persisted history',
  async (_, before, after) => {
    const f = await graphFixture();
    f.db.sqlite
      .prepare('UPDATE slot_revisions SET actor_json=?')
      .run(before ? JSON.stringify(before) : null);
    const graph = readPortableGraph(f.db, f.library.id).records;
    const changed = structuredClone(graph);
    setActor(boardRecord(changed).data.revisions[0]!, after);

    expect(() => validateGraph(f.db, f.library.id, changed)).toThrow(
      /immutable.*actor/i,
    );
    expect(() =>
      replayPortableGraph(f.db, f.paths, f.library.id, changed),
    ).toThrow(/immutable.*actor/i);
    expect(readPortableGraph(f.db, f.library.id).records).toEqual(graph);
  },
);
