import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type {
  PortableRecord,
  SyncCommit,
  SyncRemoteRecord,
} from '@cura/shared';
import { SyncState } from '../src/sync/state.js';
import { fixture } from './sync-test-fixtures.js';
it('acknowledges the submitted payload while newer local metadata remains dirty across state reopening', async () => {
  const f = await fixture(),
    store = new SyncState(f.db),
    library = f.library!,
    link = store.create(
      library.id,
      library.name,
      'owner',
      true,
      'project',
      randomUUID(),
    );
  const record: PortableRecord = {
    kind: 'library',
    id: library.id,
    libraryId: library.id,
    data: library,
  };
  const operation = store.enqueue(link.id, store.changes(link.id, [record]));
  const current = {
    ...record,
    data: { ...library, name: 'Edited during upload' },
  };
  const ack: SyncCommit = {
    sequence: '1',
    operationId: operation.id,
    changes: operation.changes.map(
      ({ expectedRevision: _expected, ...change }) => {
        void _expected;
        return {
          ...change,
          revision: '1',
          createdAt: library.createdAt,
          updatedAt: library.updatedAt,
        };
      },
    ),
  };
  store.acknowledge(link.id, operation, ack);
  const reopened = new SyncState(f.db);
  expect(reopened.pending(link.id)).toBeNull();
  expect(reopened.baselines(link.id)[0]!.payload).toEqual(record);
  expect(reopened.changes(link.id, [current])[0]?.payload).toEqual(current);
  expect(
    reopened.changes(link.id, [
      {
        ...record,
        data: { ...library, updatedAt: '2027-01-01T00:00:00.000Z' },
      },
    ]),
  ).toEqual([]);
});
it('retains a durable operation when its acknowledgment payload is corrupt', async () => {
  const f = await fixture(),
    store = new SyncState(f.db),
    library = f.library!,
    link = store.create(
      library.id,
      library.name,
      'owner',
      true,
      'project',
      randomUUID(),
    );
  const operation = store.enqueue(
    link.id,
    store.changes(link.id, [
      { kind: 'library', id: library.id, libraryId: library.id, data: library },
    ]),
  );
  const ack: SyncCommit = {
    sequence: '1',
    operationId: operation.id,
    changes: [
      {
        kind: 'library',
        key: library.id,
        revision: '1',
        payload: {
          kind: 'library',
          id: library.id,
          libraryId: library.id,
          data: { ...library, name: 'server changed submitted value' },
        },
        tombstone: false,
        createdAt: library.createdAt,
        updatedAt: library.updatedAt,
      },
    ],
  };
  expect(() => store.acknowledge(link.id, operation, ack)).toThrow(
    /acknowledgment changed/,
  );
  expect(store.pending(link.id)?.id).toBe(operation.id);
  expect(store.baselines(link.id)).toEqual([]);
});
it('does not regress a newer pulled baseline when an older uncertain commit is acknowledged', async () => {
  const f = await fixture(),
    state = new SyncState(f.db),
    library = f.library!;
  const link = state.create(
    library.id,
    library.name,
    'owner',
    true,
    'project',
    randomUUID(),
  );
  const record: PortableRecord = {
    kind: 'library',
    id: library.id,
    libraryId: library.id,
    data: library,
  };
  const operation = state.enqueue(link.id, state.changes(link.id, [record]));
  const original: SyncRemoteRecord = {
    kind: 'library',
    key: library.id,
    revision: '1',
    payload: record,
    tombstone: false,
    createdAt: library.createdAt,
    updatedAt: library.updatedAt,
  };
  const newer = {
    ...original,
    revision: '2',
    payload: { ...record, data: { ...library, name: 'Newer cloud value' } },
  };
  state.saveBaselines(link.id, [newer]);
  state.acknowledge(link.id, operation, {
    sequence: '1',
    operationId: operation.id,
    changes: [original],
  });
  expect(state.baselines(link.id)).toEqual([newer]);
  expect(state.pending(link.id)).toBeNull();
  expect(() =>
    state.saveBaselines(link.id, [{ ...original, revision: '2' }]),
  ).toThrow(/revision/);
});
it('rejects a damaged durable outbox before sending a changed request under the old operation ID', async () => {
  const f = await fixture(),
    state = new SyncState(f.db),
    library = f.library!;
  const link = state.create(
    library.id,
    library.name,
    'owner',
    true,
    'project',
    randomUUID(),
  );
  const operation = state.enqueue(
    link.id,
    state.changes(link.id, [
      { kind: 'library', id: library.id, libraryId: library.id, data: library },
    ]),
  );
  const altered = structuredClone(operation.changes);
  const value = altered[0]!.payload!;
  if (value.kind === 'library') value.data.name = 'Changed on disk';
  f.db.sqlite
    .prepare('UPDATE sync_outbox SET payload=? WHERE id=?')
    .run(JSON.stringify(altered), operation.id);
  expect(() => state.pending(link.id)).toThrow(/pending operation/);
  expect(
    f.db.sqlite
      .prepare('SELECT status FROM sync_outbox WHERE id=?')
      .get(operation.id),
  ).toEqual({ status: 'pending' });
});
