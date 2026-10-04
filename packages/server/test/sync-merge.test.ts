import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import * as S from '@cura/shared';
import { validateGraph } from '../src/sync/validate.js';
import { replayPortableGraph } from '../src/sync/replay.js';
import { mergeGraphs } from '../src/sync/merge.js';
import { readPortableGraph, semanticHash } from '../src/sync/portable.js';
import { graphFixture } from './sync-test-fixtures.js';

it('keeps independent remote fields, local conflicting fields, and both version identities', async () => {
  const f = await graphFixture(),
    base = readPortableGraph(f.db, f.library.id).records,
    local = structuredClone(base),
    remote = structuredClone(base);
  const a = local.find((r) => r.kind === 'asset')!,
    b = remote.find((r) => r.kind === 'asset')!;
  a.data.asset.note = 'local note';
  b.data.asset.note = 'remote note';
  b.data.asset.rating = 4;
  const localVersion = {
      ...a.data.versions[1]!,
      id: randomUUID(),
      ordinal: 3,
      hash: 'a'.repeat(64),
    },
    remoteVersion = {
      ...b.data.versions[1]!,
      id: randomUUID(),
      ordinal: 3,
      hash: 'b'.repeat(64),
    };
  a.data.versions.push(localVersion);
  b.data.versions.push(remoteVersion);
  a.data.asset.currentVersionId = localVersion.id;
  b.data.asset.currentVersionId = remoteVersion.id;
  const result = mergeGraphs(
      f.library.id,
      randomUUID(),
      randomUUID(),
      base,
      local,
      remote,
    ),
    merged = result.records.find((r) => r.kind === 'asset')!;
  expect(merged.data.asset).toMatchObject({
    note: 'local note',
    rating: 4,
    currentVersionId: localVersion.id,
    hash: localVersion.hash,
  });
  expect(merged.data.versions.map((v) => v.ordinal)).toEqual([4, 3, 2, 1]);
  expect(merged.data.versions.map((v) => v.id)).toEqual(
    expect.arrayContaining([localVersion.id, remoteVersion.id]),
  );
  expect(
    result.conflicts.some(
      (c) => c.entityId === a.id && c.resolution === 'merged-history',
    ),
  ).toBe(true);
});
it('retains competing slot histories and makes its winning final pin the latest idempotent revision', async () => {
  const f = await graphFixture(),
    base = readPortableGraph(f.db, f.library.id).records,
    local = structuredClone(base),
    remote = structuredClone(base);
  const a = local.find((r) => r.kind === 'board')!,
    b = remote.find((r) => r.kind === 'board')!,
    asset = local.find((r) => r.kind === 'asset')!;
  const ownerId = a.data.finalSelections[0]!.ownerId,
    slot = a.data.slots.find((s) => s.id === ownerId)!,
    other = b.data.slots.find((s) => s.id === ownerId)!,
    pin = { assetId: asset.id, versionId: asset.data.asset.currentVersionId };
  slot.currentPin = pin;
  slot.revision = 2;
  other.currentPin = null;
  other.revision = 2;
  a.data.finalSelections[0] = { ...a.data.finalSelections[0]!, ...pin };
  b.data.finalSelections = [];
  const source = a.data.revisions[0]!;
  a.data.revisions.push({ ...source, id: randomUUID(), ordinal: 2, pin });
  b.data.revisions.push({ ...source, id: randomUUID(), ordinal: 2, pin: null });
  const linkId = randomUUID(),
    operationId = randomUUID(),
    first = mergeGraphs(f.library.id, linkId, operationId, base, local, remote),
    second = mergeGraphs(
      f.library.id,
      linkId,
      operationId,
      base,
      local,
      remote,
    );
  expect(first.records).toEqual(second.records);
  const merged = first.records.find((r) => r.kind === 'board')!;
  expect(merged.data.slots.find((s) => s.id === ownerId)!.currentPin).toEqual(
    pin,
  );
  const history = merged.data.revisions
    .filter((r) => r.slotId === slot.id)
    .sort((x, y) => x.ordinal - y.ordinal);
  expect(history).toHaveLength(
    merged.data.slots.find((s) => s.id === ownerId)!.revision,
  );
  expect(history.at(-1)!.pin).toEqual(pin);
  expect(history.map((r) => r.id)).toEqual(
    expect.arrayContaining(
      [...a.data.revisions, ...b.data.revisions].map((r) => r.id),
    ),
  );
});
it('restores archived assets protected by any retained final owner and records the resolution', async () => {
  const f = await graphFixture(),
    base = readPortableGraph(f.db, f.library.id).records,
    local = structuredClone(base),
    remote = structuredClone(base);
  const asset = local.find((r) => r.kind === 'asset')!;
  asset.data.asset.archivedAt = '2026-10-04T00:00:00.000Z';
  const merged = mergeGraphs(
    f.library.id,
    randomUUID(),
    randomUUID(),
    base,
    local,
    remote,
  );
  expect(
    merged.records.find((r) => r.kind === 'asset')!.data.asset.archivedAt,
  ).toBeNull();
  expect(merged.conflicts[0]?.resolution).toBe('final-protection');
});

it('restores remotely deleted dependencies required by local edits and logs their identities', async () => {
  const f = await graphFixture();
  const grandparent = f.catalog.createFolder(f.library.id, {
    name: 'Ancestor',
  });
  const parent = f.catalog.createFolder(f.library.id, {
    name: 'Parent',
    parentId: grandparent.id,
  });
  const child = f.catalog.createFolder(f.library.id, { name: 'Child' });
  const group = f.catalog.createTagGroup(f.library.id, { name: 'Group' });
  const tag = f.catalog.createTag(f.library.id, {
    name: 'New tag',
    groupId: group.id,
  });
  const base = readPortableGraph(f.db, f.library.id).records;
  const local = structuredClone(base);
  const deleted = new Set([grandparent.id, parent.id, group.id, tag.id]);
  const remote = structuredClone(base).filter(
    (record) => !deleted.has(record.id),
  );
  const moved = local.find(
    (record) => record.kind === 'folder' && record.id === child.id,
  )!;
  if (moved.kind !== 'folder') throw new Error('Fixture kind');
  moved.data.parentId = parent.id;
  const asset = local.find((record) => record.kind === 'asset')!;
  asset.data.asset.folderId = parent.id;
  asset.data.tagLinks.push({
    assetId: asset.id,
    tagId: tag.id,
    createdAt: tag.createdAt,
    updatedAt: tag.updatedAt,
  });
  const merged = mergeGraphs(
    f.library.id,
    randomUUID(),
    randomUUID(),
    base,
    local,
    remote,
  );
  expect(() => validateGraph(f.db, f.library.id, merged.records)).not.toThrow();
  expect(merged.records.map((record) => record.id)).toEqual(
    expect.arrayContaining([...deleted]),
  );
  for (const id of deleted) {
    expect(
      merged.conflicts.some(
        (conflict) =>
          conflict.entityId === id && conflict.resolution === 'local-wins',
      ),
    ).toBe(true);
  }
});

it('keeps local deletions while clearing new remote mutable references', async () => {
  const f = await graphFixture();
  const parent = f.catalog.createFolder(f.library.id, { name: 'Parent' });
  const child = f.catalog.createFolder(f.library.id, { name: 'Child' });
  const tag = f.catalog.createTag(f.library.id, { name: 'Removed tag' });
  const base = readPortableGraph(f.db, f.library.id).records;
  const local = structuredClone(base).filter(
    (record) => ![parent.id, tag.id].includes(record.id),
  );
  const remote = structuredClone(base);
  const moved = remote.find(
    (record) => record.kind === 'folder' && record.id === child.id,
  )!;
  if (moved.kind !== 'folder') throw new Error('Fixture kind');
  moved.data.parentId = parent.id;
  const asset = remote.find((record) => record.kind === 'asset')!;
  asset.data.asset.folderId = parent.id;
  asset.data.tagLinks.push({
    assetId: asset.id,
    tagId: tag.id,
    createdAt: tag.createdAt,
    updatedAt: tag.updatedAt,
  });
  const merged = mergeGraphs(
    f.library.id,
    randomUUID(),
    randomUUID(),
    base,
    local,
    remote,
  );
  expect(() => validateGraph(f.db, f.library.id, merged.records)).not.toThrow();
  expect(
    merged.records.some(
      (record) => record.id === parent.id || record.id === tag.id,
    ),
  ).toBe(false);
  expect(
    merged.records.find(
      (record) => record.kind === 'folder' && record.id === child.id,
    )?.data,
  ).toMatchObject({ parentId: null });
  expect(
    merged.records.find((record) => record.kind === 'asset')?.data.asset
      .folderId,
  ).toBeNull();
  expect(
    merged.records
      .find((record) => record.kind === 'asset')
      ?.data.tagLinks.some((link) => link.tagId === tag.id),
  ).toBe(false);
  expect(
    merged.conflicts.some((conflict) => conflict.entityId === asset.id),
  ).toBe(true);
});

it('does not resurrect deleted tags and folders referenced only by weak collection/archive filters', async () => {
  const f = await graphFixture();
  const folder = f.catalog.createFolder(f.library.id, { name: 'Weak folder' });
  const tag = f.catalog.createTag(f.library.id, { name: 'Weak tag' });
  const collection = f.catalog.createCollection(f.library.id, {
    name: 'Weak collection',
    rules: { folderId: folder.id, tagId: tag.id },
  });
  const ruleId = randomUUID();
  const rule = S.PortableRecordSchema.parse({
    kind: 'archiveRule',
    id: ruleId,
    libraryId: f.library.id,
    data: {
      id: ruleId,
      libraryId: f.library.id,
      name: 'Archive',
      enabled: false,
      revision: 0,
      lastJobId: null,
      filters: {
        folderId: folder.id,
        tagIds: [tag.id],
        olderThanDays: 30,
        maxRating: 5,
      },
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
    },
  });
  const base = [...readPortableGraph(f.db, f.library.id).records, rule];
  const local = structuredClone(base);
  const remote = structuredClone(base).filter(
    (record) => ![folder.id, tag.id].includes(record.id),
  );
  const merged = mergeGraphs(
    f.library.id,
    randomUUID(),
    randomUUID(),
    base,
    local,
    remote,
  );
  expect(
    merged.records.some(
      (record) => record.id === folder.id || record.id === tag.id,
    ),
  ).toBe(false);
  expect(merged.records.find((record) => record.id === ruleId)).toEqual(rule);
  expect(
    merged.records.find(
      (record) => record.kind === 'collection' && record.id === collection.id,
    )?.data,
  ).toEqual(collection);
  expect(() => validateGraph(f.db, f.library.id, merged.records)).not.toThrow();
});

it('keeps a local slot reassignment active against remote deletion while retaining both histories', async () => {
  const f = await graphFixture();
  const base = readPortableGraph(f.db, f.library.id).records;
  const local = structuredClone(base);
  const board = local.find((record) => record.kind === 'board')!;
  const slot = board.data.slots.find((value) => value.currentPin)!;
  const pin = {
    assetId: f.asset.id,
    versionId: f.catalog.getAsset(f.asset.id).currentVersionId,
  };
  const localRevision = {
    ...board.data.revisions[0]!,
    id: randomUUID(),
    ordinal: slot.revision + 1,
    pin,
  };
  slot.currentPin = pin;
  slot.revision++;
  board.data.revisions.push(localRevision);
  board.data.finalSelections[0] = { ...board.data.finalSelections[0]!, ...pin };
  board.data.board.revision++;
  f.boards.deleteSlot(slot.id, { expectedRevision: slot.revision - 1 });
  const remote = readPortableGraph(f.db, f.library.id).records;
  const merged = mergeGraphs(
    f.library.id,
    randomUUID(),
    randomUUID(),
    base,
    local,
    remote,
  );
  expect(() => validateGraph(f.db, f.library.id, merged.records)).not.toThrow();
  const result = merged.records.find((record) => record.kind === 'board')!;
  expect(result.data.slots.find((value) => value.id === slot.id)).toMatchObject(
    { deletedAt: null, currentPin: pin },
  );
  expect(result.data.revisions.map((revision) => revision.id)).toContain(
    localRevision.id,
  );
  expect(result.data.revisions.map((revision) => revision.id)).toEqual(
    expect.arrayContaining(
      remote
        .find((record) => record.kind === 'board')!
        .data.revisions.map((revision) => revision.id),
    ),
  );
  expect(
    result.data.finalSelections.some(
      (selection) =>
        selection.ownerId === slot.id && selection.versionId === pin.versionId,
    ),
  ).toBe(true);
});

it('preserves local board edits and final owners when another device deletes the board', async () => {
  const f = await graphFixture();
  const base = readPortableGraph(f.db, f.library.id).records;
  const local = structuredClone(base);
  const board = local.find((record) => record.kind === 'board')!;
  board.data.board.name = 'Locally edited board';
  board.data.board.revision++;
  f.boards.deleteBoard(board.id, {
    expectedRevision: board.data.board.revision - 1,
  });
  const remote = readPortableGraph(f.db, f.library.id).records;
  const merged = mergeGraphs(
    f.library.id,
    randomUUID(),
    randomUUID(),
    base,
    local,
    remote,
  );
  expect(() => validateGraph(f.db, f.library.id, merged.records)).not.toThrow();
  const result = merged.records.find((record) => record.kind === 'board')!;
  expect(result.data.board.deletedAt).toBeNull();
  expect(result.data.board.name).toBe('Locally edited board');
  expect(result.data.finalSelections.map((selection) => selection.id)).toEqual(
    board.data.finalSelections.map((selection) => selection.id),
  );
  expect(result.data.slots.every((slot) => slot.deletedAt === null)).toBe(true);
});

it('keeps a local board deletion coherent against a remote slot reassignment', async () => {
  const f = await graphFixture();
  const base = readPortableGraph(f.db, f.library.id).records;
  const remote = structuredClone(base);
  const board = remote.find((record) => record.kind === 'board')!;
  const slot = board.data.slots.find((value) => value.currentPin)!;
  const pin = {
    assetId: f.asset.id,
    versionId: f.catalog.getAsset(f.asset.id).currentVersionId,
  };
  slot.currentPin = pin;
  slot.revision++;
  board.data.revisions.push({
    ...board.data.revisions[0]!,
    id: randomUUID(),
    ordinal: slot.revision,
    pin,
  });
  board.data.finalSelections[0] = { ...board.data.finalSelections[0]!, ...pin };
  board.data.board.revision++;
  f.boards.deleteBoard(board.id, {
    expectedRevision: board.data.board.revision - 1,
  });
  const local = readPortableGraph(f.db, f.library.id).records;
  const merged = mergeGraphs(
    f.library.id,
    randomUUID(),
    randomUUID(),
    base,
    local,
    remote,
  );
  expect(() => validateGraph(f.db, f.library.id, merged.records)).not.toThrow();
  const result = merged.records.find((record) => record.kind === 'board')!;
  expect(result.data.board.deletedAt).not.toBeNull();
  expect(
    result.data.slots.every(
      (value) => value.deletedAt !== null && value.currentPin === null,
    ),
  ).toBe(true);
  expect(result.data.finalSelections).toEqual([]);
});

it('advances every editable aggregate revision when combining competing writes', async () => {
  const f = await graphFixture();
  f.brands.createCmfBoard(f.library.id, { name: 'CMF' });
  const date = f.library.createdAt;
  const make = (
    kind: string,
    data: Record<string, unknown>,
  ): S.PortableRecord => {
    const id = randomUUID();
    return S.PortableRecordSchema.parse({
      kind,
      id,
      libraryId: f.library.id,
      data: {
        id,
        libraryId: f.library.id,
        createdAt: date,
        updatedAt: date,
        revision: 0,
        ...data,
      },
    });
  };
  const base = [
    ...readPortableGraph(f.db, f.library.id).records,
    make('archiveRule', {
      name: 'Rule',
      enabled: false,
      filters: {},
      lastJobId: null,
    }),
    make('scriptBreakdown', {
      title: 'Script',
      sourcePin: f.pin,
      sourceHash: 'a'.repeat(64),
      lineCount: 1,
      entities: [],
      provenance: {
        providerId: 'rules',
        kind: 'structured-script',
        mode: 'rules',
        model: null,
        rawText: '',
        derivation: null,
        inputKind: 'text',
        sourceHash: 'a'.repeat(64),
      },
    }),
    make('settingDocument', {
      title: 'Document',
      kind: 'general',
      language: 'en',
      markdown: 'Before',
      scriptId: null,
      entities: [],
      provenance: 'metadata-document-v1',
      sources: [
        {
          ...f.pin,
          hash: 'a'.repeat(64),
          name: 'Asset',
          note: '',
          prompt: '',
          negativePrompt: '',
          model: '',
          source: '',
          seed: '',
          width: null,
          height: null,
          tags: [],
        },
      ],
    }),
  ];
  const local = structuredClone(base),
    remote = structuredClone(base);
  const kinds = new Set([
    'brand',
    'cmf',
    'archiveRule',
    'scriptBreakdown',
    'settingDocument',
  ]);
  for (const graph of [local, remote])
    for (const record of graph) {
      if (!kinds.has(record.kind) || !('revision' in record.data)) continue;
      record.data.revision++;
      if ('name' in record.data)
        record.data.name = graph === local ? 'Local name' : 'Remote name';
      if ('title' in record.data)
        record.data.title = graph === local ? 'Local title' : 'Remote title';
    }
  const merged = mergeGraphs(
    f.library.id,
    randomUUID(),
    randomUUID(),
    base,
    local,
    remote,
  );
  for (const record of merged.records) {
    if (!kinds.has(record.kind) || !('revision' in record.data)) continue;
    const previous = local.find((value) => value.id === record.id)!;
    if (!('revision' in previous.data)) throw new Error('Fixture revision');
    expect(record.data.revision).toBe(previous.data.revision + 1);
  }
  replayPortableGraph(f.db, f.paths, f.library.id, merged.records);
  const oldBrand = local.find((record) => record.kind === 'brand')!;
  expect(() =>
    f.brands.saveBrand(oldBrand.id, {
      expectedRevision: oldBrand.data.revision,
      name: oldBrand.data.name,
      guidelines: oldBrand.data.guidelines,
      colors: [],
      fonts: [],
      logos: [],
    }),
  ).toThrow('This brand changed. Reload before saving.');
});

it('restores a removed matrix axis needed by a locally reassigned cell', async () => {
  const f = await graphFixture();
  const row = { id: randomUUID(), label: 'Locally used row' };
  const other = { id: randomUUID(), label: 'Other row' };
  const column = { id: randomUUID(), label: 'Column' };
  let document = f.boards.createBoard(f.library.id, {
    name: 'Matrix',
    kind: 'matrix',
    rows: [row, other],
    columns: [column],
  });
  const slotId = document.slots.find((slot) => slot.rowId === row.id)!.id;
  document = f.boards.assignSlot(slotId, { expectedRevision: 0, pin: f.pin });
  const base = readPortableGraph(f.db, f.library.id).records;
  const local = structuredClone(base);
  const record = local.find(
    (value) => value.kind === 'board' && value.id === document.board.id,
  )!;
  if (record.kind !== 'board') throw new Error('Fixture kind');
  const slot = record.data.slots.find((value) => value.id === slotId)!;
  const pin = {
    assetId: f.asset.id,
    versionId: f.catalog.getAsset(f.asset.id).currentVersionId,
  };
  slot.currentPin = pin;
  slot.revision++;
  record.data.revisions.push({
    ...record.data.revisions.find((value) => value.slotId === slotId)!,
    id: randomUUID(),
    ordinal: slot.revision,
    pin,
  });
  const selection = record.data.finalSelections.find(
    (value) => value.ownerId === slotId,
  )!;
  Object.assign(selection, pin);
  record.data.board.revision++;
  f.boards.updateBoard(document.board.id, {
    expectedRevision: document.board.revision,
    rows: [other],
  });
  const remote = readPortableGraph(f.db, f.library.id).records;
  const merged = mergeGraphs(
    f.library.id,
    randomUUID(),
    randomUUID(),
    base,
    local,
    remote,
  );
  expect(() => validateGraph(f.db, f.library.id, merged.records)).not.toThrow();
  const result = merged.records.find(
    (value) => value.kind === 'board' && value.id === record.id,
  )!;
  if (result.kind !== 'board') throw new Error('Fixture kind');
  expect(result.data.board.rows).toContainEqual(row);
  expect(result.data.slots.find((value) => value.id === slotId)).toMatchObject({
    deletedAt: null,
    currentPin: pin,
  });
});

it.each([2, 3])(
  'resolves a %i-folder merge cycle without losing local moves or unrelated remote edits',
  async (count) => {
    const f = await graphFixture();
    const folders = Array.from({ length: count }, (_, i) =>
      f.catalog.createFolder(f.library.id, { name: `Folder ${i}` }),
    );
    const base = readPortableGraph(f.db, f.library.id).records;
    const local = structuredClone(base),
      remote = structuredClone(base);
    const folder = (records: S.PortableRecord[], index: number) =>
      records.find(
        (r): r is Extract<S.PortableRecord, { kind: 'folder' }> =>
          r.kind === 'folder' && r.id === folders[index]!.id,
      )!;
    folder(local, 0).data.parentId = folders[1]!.id;
    for (let i = 1; i < count; i++)
      folder(remote, i).data.parentId = folders[(i + 1) % count]!.id;
    folder(remote, 1).data.name = 'Remote rename';
    validateGraph(f.db, f.library.id, local);
    validateGraph(f.db, f.library.id, remote);
    const linkId = randomUUID(),
      operationId = randomUUID();
    const merged = mergeGraphs(
      f.library.id,
      linkId,
      operationId,
      base,
      local,
      remote,
    );
    expect(() =>
      validateGraph(f.db, f.library.id, merged.records),
    ).not.toThrow();
    expect(folder(merged.records, 0).data.parentId).toBe(folders[1]!.id);
    expect(folder(merged.records, 1).data.name).toBe('Remote rename');
    expect(merged.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resolution: 'local-wins',
          changedFields: expect.arrayContaining(['/data/parentId']),
          local: expect.any(Object),
          remote: expect.any(Object),
          resolved: expect.any(Object),
        }),
      ]),
    );
    expect(
      mergeGraphs(f.library.id, linkId, operationId, base, local, remote),
    ).toEqual(merged);
    replayPortableGraph(f.db, f.paths, f.library.id, merged.records);
    const reread = readPortableGraph(f.db, f.library.id).records;
    expect(semanticHash(reread)).toBe(semanticHash(merged.records));
    const settled = mergeGraphs(
      f.library.id,
      linkId,
      randomUUID(),
      merged.records,
      reread,
      merged.records,
    );
    expect(settled.conflicts).toEqual([]);
    expect(semanticHash(settled.records)).toBe(semanticHash(merged.records));
  },
);

function boardGroups(records: S.PortableRecord[]) {
  const board = records.find((r) => r.kind === 'board')!;
  const group = (label: string): S.BoardItem => ({
    id: randomUUID(),
    boardId: board.id,
    libraryId: board.libraryId,
    createdAt: board.data.board.createdAt,
    updatedAt: board.data.board.updatedAt,
    kind: 'group',
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    groupId: null,
    label,
    text: '',
    assetId: null,
    versionId: null,
  });
  board.data.items.push(group('A'), group('B'));
  return board;
}

it('resolves concurrent board group moves with a valid replay and a recorded local winner', async () => {
  const f = await graphFixture(),
    base = readPortableGraph(f.db, f.library.id).records;
  const original = boardGroups(base),
    [a, b] = original.data.items;
  const local = structuredClone(base),
    remote = structuredClone(base);
  const ours = local.find((r) => r.kind === 'board')!,
    theirs = remote.find((r) => r.kind === 'board')!;
  ours.data.items[0]!.groupId = b!.id;
  theirs.data.items[1]!.groupId = a!.id;
  theirs.data.items[1]!.label = 'Remote rename';
  validateGraph(f.db, f.library.id, local);
  validateGraph(f.db, f.library.id, remote);
  const linkId = randomUUID(),
    operationId = randomUUID();
  const merged = mergeGraphs(
    f.library.id,
    linkId,
    operationId,
    base,
    local,
    remote,
  );
  expect(() => validateGraph(f.db, f.library.id, merged.records)).not.toThrow();
  const board = merged.records.find((r) => r.kind === 'board')!;
  expect(board.data.items.find((i) => i.id === a!.id)!.groupId).toBe(b!.id);
  expect(board.data.items.find((i) => i.id === b!.id)).toMatchObject({
    groupId: null,
    label: 'Remote rename',
  });
  expect(merged.conflicts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        entityId: original.id,
        changedFields: expect.arrayContaining([`/data/items/${b!.id}/groupId`]),
        local: ours,
        remote: theirs,
        resolved: board,
      }),
    ]),
  );
  expect(
    mergeGraphs(f.library.id, linkId, operationId, base, local, remote),
  ).toEqual(merged);
  replayPortableGraph(f.db, f.paths, f.library.id, merged.records);
  expect(semanticHash(readPortableGraph(f.db, f.library.id).records)).toBe(
    semanticHash(merged.records),
  );
});

it.each([false, true])(
  'keeps board edges closed when endpoint deletion is local=%s',
  async (localDeletion) => {
    const f = await graphFixture(),
      base = readPortableGraph(f.db, f.library.id).records;
    const original = boardGroups(base),
      [a, b] = original.data.items;
    const local = structuredClone(base),
      remote = structuredClone(base);
    const ours = local.find((r) => r.kind === 'board')!,
      theirs = remote.find((r) => r.kind === 'board')!;
    const deletion = localDeletion ? ours : theirs,
      addition = localDeletion ? theirs : ours;
    deletion.data.items = deletion.data.items.filter((i) => i.id !== a!.id);
    addition.data.edges.push({
      id: randomUUID(),
      boardId: original.id,
      libraryId: f.library.id,
      createdAt: a!.createdAt,
      updatedAt: a!.updatedAt,
      sourceId: a!.id,
      targetId: b!.id,
      label: 'Connection',
    });
    validateGraph(f.db, f.library.id, local);
    validateGraph(f.db, f.library.id, remote);
    const merged = mergeGraphs(
      f.library.id,
      randomUUID(),
      randomUUID(),
      base,
      local,
      remote,
    );
    expect(() =>
      validateGraph(f.db, f.library.id, merged.records),
    ).not.toThrow();
    const board = merged.records.find((r) => r.kind === 'board')!;
    expect(board.data.items.some((i) => i.id === a!.id)).toBe(!localDeletion);
    expect(board.data.edges).toHaveLength(localDeletion ? 0 : 1);
    expect(
      merged.conflicts.some(
        (c) => c.entityId === original.id && c.local && c.remote,
      ),
    ).toBe(true);
    replayPortableGraph(f.db, f.paths, f.library.id, merged.records);
    expect(semanticHash(readPortableGraph(f.db, f.library.id).records)).toBe(
      semanticHash(merged.records),
    );
  },
);

it.each([false, true])(
  'keeps board groups closed when parent deletion is local=%s',
  async (localDeletion) => {
    const f = await graphFixture(),
      base = readPortableGraph(f.db, f.library.id).records;
    const original = boardGroups(base),
      [a, b] = original.data.items;
    const local = structuredClone(base),
      remote = structuredClone(base);
    const ours = local.find((r) => r.kind === 'board')!,
      theirs = remote.find((r) => r.kind === 'board')!;
    const deletion = localDeletion ? ours : theirs,
      addition = localDeletion ? theirs : ours;
    deletion.data.items = deletion.data.items.filter((i) => i.id !== a!.id);
    addition.data.items[1]!.groupId = a!.id;
    validateGraph(f.db, f.library.id, local);
    validateGraph(f.db, f.library.id, remote);
    const merged = mergeGraphs(
      f.library.id,
      randomUUID(),
      randomUUID(),
      base,
      local,
      remote,
    );
    expect(() =>
      validateGraph(f.db, f.library.id, merged.records),
    ).not.toThrow();
    const board = merged.records.find((r) => r.kind === 'board')!;
    expect(board.data.items.some((i) => i.id === a!.id)).toBe(!localDeletion);
    expect(board.data.items.find((i) => i.id === b!.id)!.groupId).toBe(
      localDeletion ? null : a!.id,
    );
    expect(
      merged.conflicts.some(
        (c) => c.entityId === original.id && c.local && c.remote,
      ),
    ).toBe(true);
    replayPortableGraph(f.db, f.paths, f.library.id, merged.records);
    expect(semanticHash(readPortableGraph(f.db, f.library.id).records)).toBe(
      semanticHash(merged.records),
    );
  },
);
