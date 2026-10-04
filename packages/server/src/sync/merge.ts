import { createHash } from 'node:crypto';
import * as S from '@cura/shared';
import { canonical, recordKey, semanticHash } from './portable.js';
import { invalidGraph } from './errors.js';

export const stableId = (text: string): string => {
  const hex = createHash('sha256').update(text).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
};
const equal = (a: unknown, b: unknown) =>
  a === undefined || b === undefined
    ? a === b
    : semanticHash(a) === semanticHash(b);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const keyOf = (value: unknown): string | null =>
  object(value)
    ? typeof value.id === 'string'
      ? value.id
      : typeof value.tagId === 'string'
        ? value.tagId
        : null
    : null;
const sorted = (items: unknown[]): unknown[] =>
  items.sort((a, b) => {
    if (object(a) && object(b)) {
      if (typeof a.position === 'number' && typeof b.position === 'number')
        return a.position - b.position;
      const x = `${String(a.createdAt ?? '')}:${keyOf(a) ?? ''}`,
        y = `${String(b.createdAt ?? '')}:${keyOf(b) ?? ''}`;
      return x < y ? -1 : x > y ? 1 : 0;
    }
    return 0;
  });
function mergeValue(
  base: unknown,
  local: unknown,
  remote: unknown,
  path: string,
  fields: Set<string>,
): unknown {
  if (equal(local, base)) return structuredClone(remote);
  if (equal(remote, base) || equal(local, remote))
    return structuredClone(local);
  if (
    path.endsWith('/updatedAt') &&
    typeof local === 'string' &&
    typeof remote === 'string'
  )
    return local > remote ? local : remote;
  if (
    path.endsWith('/currentPin') ||
    path.endsWith('/pin') ||
    path.endsWith('/manualSelection')
  ) {
    fields.add(path);
    return structuredClone(local);
  }
  if (
    Array.isArray(local) &&
    Array.isArray(remote) &&
    local.every((v) => keyOf(v) !== null) &&
    remote.every((v) => keyOf(v) !== null)
  ) {
    const a = new Map(
        (Array.isArray(base) ? base : []).map((v) => [keyOf(v), v]),
      ),
      b = new Map(local.map((v) => [keyOf(v), v])),
      c = new Map(remote.map((v) => [keyOf(v), v]));
    return sorted(
      [...new Set([...a.keys(), ...b.keys(), ...c.keys()])]
        .map((id) =>
          mergeValue(a.get(id), b.get(id), c.get(id), `${path}/${id}`, fields),
        )
        .filter((v) => v !== undefined),
    );
  }
  if (object(local) && object(remote))
    return Object.fromEntries(
      [...new Set([...Object.keys(local), ...Object.keys(remote)])]
        .map((key) => [
          key,
          mergeValue(
            object(base) ? base[key] : undefined,
            local[key],
            remote[key],
            `${path}/${key}`,
            fields,
          ),
        ])
        .filter(([, value]) => value !== undefined),
    );
  fields.add(path || '/');
  return structuredClone(local);
}
type Remap = S.SyncConflictDetail['ordinalRemaps'][number];
function unionHistory<
  T extends {
    id: string;
    ordinal: number;
    createdAt: string;
    updatedAt: string;
  },
>(
  base: T[],
  local: T[],
  remote: T[],
  kind: Remap['kind'],
  remaps: Remap[],
): T[] {
  const values = new Map<string, T>();
  for (const value of [...remote, ...local]) {
    const previous = values.get(value.id);
    if (previous) {
      if ('hash' in value && 'hash' in previous && value.hash !== previous.hash)
        invalidGraph('Conflicting immutable version hash');
      if (
        'pin' in value &&
        'pin' in previous &&
        canonical(value.pin) !== canonical(previous.pin)
      )
        invalidGraph('Conflicting immutable slot history pin');
    }
    const original = base.find((v) => v.id === value.id),
      l = local.find((v) => v.id === value.id),
      r = remote.find((v) => v.id === value.id);
    values.set(
      value.id,
      mergeValue(original, l ?? r, r ?? l, '', new Set()) as T,
    );
  }
  const initial = [...base]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((v) => v.id),
    ids = new Set(initial);
  const additions = [...values.values()]
    .filter((v) => !ids.has(v.id))
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  const ordered = [
    ...initial
      .map((id) => values.get(id))
      .filter((v): v is T => v !== undefined),
    ...additions,
  ];
  return ordered.map((value, index) => {
    const ordinal = index + 1;
    for (const before of [
      local.find((v) => v.id === value.id),
      remote.find((v) => v.id === value.id),
    ])
      if (
        before &&
        before.ordinal !== ordinal &&
        !remaps.some(
          (r) =>
            r.id === value.id && r.from === before.ordinal && r.to === ordinal,
        )
      )
        remaps.push({ kind, id: value.id, from: before.ordinal, to: ordinal });
    return { ...value, ordinal };
  });
}
export interface MergeResult {
  records: S.PortableRecord[];
  conflicts: S.SyncConflictDetail[];
}
/** Three-way metadata merge, retaining both immutable histories. Dirty local fields win. */
export function mergeGraphs(
  libraryId: string,
  linkId: string,
  operationId: string,
  base: S.PortableRecord[],
  local: S.PortableRecord[],
  remote: S.PortableRecord[],
): MergeResult {
  const map = (records: S.PortableRecord[]) =>
    new Map(records.map((record) => [recordKey(record), record]));
  const b = map(base),
    l = map(local),
    r = map(remote),
    records: S.PortableRecord[] = [],
    conflicts: S.SyncConflictDetail[] = [];
  for (const key of [
    ...new Set([...b.keys(), ...l.keys(), ...r.keys()]),
  ].sort()) {
    const before = b.get(key),
      ours = l.get(key),
      theirs = r.get(key),
      fields = new Set<string>(),
      remaps: Remap[] = [];
    let resolved = mergeValue(before, ours, theirs, '', fields) as
      | S.PortableRecord
      | undefined;
    const competing =
      !equal(ours, before) && !equal(theirs, before) && !equal(ours, theirs);
    if (
      ours &&
      theirs &&
      ours.kind === 'asset' &&
      theirs.kind === 'asset' &&
      resolved?.kind === 'asset'
    ) {
      resolved.data.versions = unionHistory(
        before?.kind === 'asset' ? before.data.versions : [],
        ours.data.versions,
        theirs.data.versions,
        'assetVersion',
        remaps,
      );
      const currentId = resolved.data.asset.currentVersionId;
      const currentVersion = resolved.data.versions.find(
        (v) => v.id === currentId,
      );
      if (!currentVersion) invalidGraph('Merged current version missing');
      const {
        id: _id,
        assetId: _assetId,
        ordinal: _ordinal,
        name: _name,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...file
      } = currentVersion;
      void _id;
      void _assetId;
      void _ordinal;
      void _name;
      void _createdAt;
      void _updatedAt;
      resolved.data.asset = { ...resolved.data.asset, ...file };
    }
    if (
      ours &&
      theirs &&
      ours.kind === 'board' &&
      theirs.kind === 'board' &&
      resolved?.kind === 'board'
    ) {
      const revisions: S.SlotRevision[] = [];
      for (const slot of resolved.data.slots) {
        const history = unionHistory(
          before?.kind === 'board'
            ? before.data.revisions.filter((v) => v.slotId === slot.id)
            : [],
          ours.data.revisions.filter((v) => v.slotId === slot.id),
          theirs.data.revisions.filter((v) => v.slotId === slot.id),
          'slotRevision',
          remaps,
        );
        const last = history.at(-1);
        if (
          (last && canonical(last.pin) !== canonical(slot.currentPin)) ||
          (!last && slot.currentPin)
        ) {
          const date = [slot.updatedAt, last?.updatedAt ?? slot.updatedAt]
            .sort()
            .at(-1)!;
          history.push({
            id: stableId(`${operationId}:${slot.id}:resolution`),
            libraryId,
            slotId: slot.id,
            ordinal: history.length + 1,
            pin: slot.currentPin,
            createdAt: date,
            updatedAt: date,
          });
        }
        slot.revision = history.length;
        revisions.push(...history);
      }
      resolved.data.revisions = revisions.sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
      resolved.data.finalSelections = resolved.data.slots
        .flatMap((slot) => {
          if (!slot.currentPin || slot.deletedAt) return [];
          const candidates = [
            ...ours.data.finalSelections,
            ...theirs.data.finalSelections,
          ];
          const selection = candidates.find(
            (s) =>
              s.ownerId === slot.id &&
              s.assetId === slot.currentPin!.assetId &&
              s.versionId === slot.currentPin!.versionId,
          );
          if (!selection) invalidGraph('Merged slot final owner missing');
          return [selection];
        })
        .sort(
          (a, b) =>
            a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
        );
      if (competing)
        resolved.data.board.revision =
          Math.max(ours.data.board.revision, theirs.data.board.revision) + 1;
    }
    if (resolved) resolved = S.PortableRecordSchema.parse(resolved);
    if (competing) {
      const entity = ours ?? theirs ?? before!,
        date =
          [ours?.data, theirs?.data]
            .flatMap((value) =>
              value && 'updatedAt' in value ? [value.updatedAt] : [],
            )
            .sort()
            .at(-1) ?? new Date().toISOString();
      conflicts.push(
        S.SyncConflictDetailSchema.parse({
          id: stableId(`${operationId}:${key}:conflict`),
          linkId,
          libraryId,
          entityKind: entity.kind,
          entityId: entity.id,
          resolution: remaps.length ? 'merged-history' : 'local-wins',
          changedFields: [...fields],
          base: before ?? null,
          local: ours ?? null,
          remote: theirs ?? null,
          resolved: resolved ?? null,
          ordinalRemaps: remaps,
          createdAt: date,
          updatedAt: date,
        }),
      );
    }
    if (resolved) records.push(resolved);
  }
  const owned = new Set(
    records.flatMap((record) =>
      record.kind === 'asset'
        ? record.data.manualSelection
          ? [record.id]
          : []
        : record.kind === 'board'
          ? record.data.finalSelections.map((s) => s.assetId)
          : [],
    ),
  );
  for (const record of records)
    if (
      record.kind === 'asset' &&
      record.data.asset.archivedAt &&
      owned.has(record.id)
    ) {
      const original = structuredClone(record);
      record.data.asset.archivedAt = null;
      const key = recordKey(record),
        date = record.data.asset.updatedAt;
      conflicts.push({
        id: stableId(`${operationId}:${key}:final-protection`),
        linkId,
        libraryId,
        entityKind: 'asset',
        entityId: record.id,
        resolution: 'final-protection',
        changedFields: ['/data/asset/archivedAt'],
        base: b.get(key) ?? null,
        local: l.get(key) ?? original,
        remote: r.get(key) ?? null,
        resolved: record,
        ordinalRemaps: [],
        createdAt: date,
        updatedAt: date,
      });
    }
  return {
    records: records.sort((a, b) => recordKey(a).localeCompare(recordKey(b))),
    conflicts,
  };
}
