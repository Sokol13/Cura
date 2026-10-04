import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { mergeGraphs } from '../src/sync/merge.js';
import { readPortableGraph } from '../src/sync/portable.js';
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
  expect(merged.data.versions.map((v) => v.ordinal)).toEqual([1, 2, 3, 4]);
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
