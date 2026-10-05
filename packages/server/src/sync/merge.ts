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
    actor?: S.SlotRevision['actor'];
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
    const previous = values.get(value.id),
      original = base.find((v) => v.id === value.id),
      l = local.find((v) => v.id === value.id),
      r = remote.find((v) => v.id === value.id);
    if (kind === 'slotRevision')
      for (const retained of [original, l, r])
        if (retained && !equal(retained.actor, value.actor))
          invalidGraph('Conflicting immutable slot history actor');
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
type PortableMap = Map<string, S.PortableRecord>;
type Dependency = {
  kind: S.PortableRecord['kind'];
  id: string;
  path: string;
  clear?: () => void;
};

/** Restore only incoming parent links involved in a cycle; valid local moves stay intact. */
function resolveParentCycles(
  nodes: Array<{
    id: string;
    parent: string | null;
    localParent: string | null | undefined;
    restore: (parent: string | null) => void;
  }>,
): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  for (;;) {
    const done = new Set<string>();
    let restored = false;
    for (const start of ordered) {
      const path = new Map<string, number>();
      let id: string | null = start.id;
      while (id && byId.has(id) && !done.has(id)) {
        if (path.has(id)) {
          const cycle = [...path.keys()].slice(path.get(id)!);
          const incoming = cycle
            .sort()
            .map((key) => byId.get(key)!)
            .find(
              (node) =>
                node.localParent !== undefined &&
                node.parent !== node.localParent,
            );
          if (incoming) {
            incoming.parent = incoming.localParent!;
            incoming.restore(incoming.parent);
            restored = true;
          }
          break;
        }
        path.set(id, path.size);
        id = byId.get(id)!.parent;
      }
      if (restored) break;
      for (const key of path.keys()) done.add(key);
    }
    // A cycle wholly present in an input remains invalid and is rejected by graph validation.
    if (!restored) return;
  }
}

/** Strong references must stay closed after independently valid edits merge.
 * Restoring a locally retained dependency honors local edits; a local deletion
 * instead clears newly received mutable references to that deleted identity. */
function closeDependencies(
  libraryId: string,
  linkId: string,
  operationId: string,
  records: S.PortableRecord[],
  conflicts: S.SyncConflictDetail[],
  base: PortableMap,
  local: PortableMap,
  remote: PortableMap,
): void {
  const resolved = new Map(
    records.map((record) => [recordKey(record), record]),
  );
  const log = (record: S.PortableRecord, path: string) => {
    const key = recordKey(record);
    const previous = conflicts.find(
      (value) =>
        value.entityKind === record.kind && value.entityId === record.id,
    );
    if (previous) {
      previous.changedFields = [...new Set([...previous.changedFields, path])];
      previous.resolved = structuredClone(record);
      return;
    }
    const entity =
      record.kind === 'asset'
        ? record.data.asset
        : record.kind === 'board'
          ? record.data.board
          : record.data;
    conflicts.push({
      id: stableId(`${operationId}:${key}:conflict`),
      linkId,
      libraryId,
      entityKind: record.kind,
      entityId: record.id,
      resolution: 'local-wins',
      changedFields: [path],
      base: base.get(key) ?? null,
      local: local.get(key) ?? null,
      remote: remote.get(key) ?? null,
      resolved: structuredClone(record),
      ordinalRemaps: [],
      createdAt: entity.updatedAt,
      updatedAt: entity.updatedAt,
    });
  };
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    const dependencies: Dependency[] = [];
    const add = (
      kind: Dependency['kind'],
      id: string | null,
      path: string,
      clear?: () => void,
    ) => {
      if (id)
        dependencies.push({ kind, id, path, ...(clear ? { clear } : {}) });
    };
    const pin = (value: { assetId: string } | null, path: string) =>
      add('asset', value?.assetId ?? null, path);
    switch (record.kind) {
      case 'folder':
        add('folder', record.data.parentId, '/data/parentId', () => {
          record.data.parentId = null;
        });
        break;
      case 'tag':
        add('tagGroup', record.data.groupId, '/data/groupId', () => {
          record.data.groupId = null;
        });
        break;
      case 'asset':
        add(
          'folder',
          record.data.asset.folderId,
          '/data/asset/folderId',
          () => {
            record.data.asset.folderId = null;
          },
        );
        for (const link of record.data.tagLinks)
          add('tag', link.tagId, `/data/tagLinks/${link.tagId}`, () => {
            record.data.tagLinks = record.data.tagLinks.filter(
              (value) => value.tagId !== link.tagId,
            );
          });
        for (const version of record.data.versions)
          add(
            'generation',
            version.generationId,
            `/data/versions/${version.id}/generationId`,
          );
        break;
      case 'board': {
        const before = base.get(recordKey(record)),
          ours = local.get(recordKey(record)),
          theirs = remote.get(recordKey(record));
        const items = new Map(record.data.items.map((item) => [item.id, item]));
        const localItems = new Map(
          ours?.kind === 'board'
            ? ours.data.items.map((item) => [item.id, item])
            : [],
        );
        const locallyDeleted = (id: string) =>
          !localItems.has(id) &&
          before?.kind === 'board' &&
          before.data.items.some((item) => item.id === id) &&
          theirs?.kind === 'board' &&
          theirs.data.items.some((item) => item.id === id);
        const restoreItem = (id: string): boolean => {
          if (items.has(id)) return true;
          const item = localItems.get(id);
          if (!item) return false;
          const restored = structuredClone(item);
          items.set(id, restored);
          record.data.items.push(restored);
          log(record, `/data/items/${id}`);
          return true;
        };
        record.data.edges = record.data.edges.filter((edge) => {
          const missing = [edge.sourceId, edge.targetId].filter(
            (id) => !items.has(id),
          );
          if (missing.some(locallyDeleted)) {
            log(record, `/data/edges/${edge.id}`);
            return false;
          }
          for (const id of missing) restoreItem(id);
          return true;
        });
        // Restored endpoints can themselves have parents; process the growing list to closure.
        for (const item of record.data.items) {
          if (
            item.groupId &&
            !restoreItem(item.groupId) &&
            locallyDeleted(item.groupId)
          ) {
            item.groupId = null;
            log(record, `/data/items/${item.id}/groupId`);
          }
        }
        resolveParentCycles(
          record.data.items.map((item) => ({
            id: item.id,
            parent: item.groupId,
            localParent: localItems.get(item.id)?.groupId,
            restore: (parent) => {
              item.groupId = parent;
              log(record, `/data/items/${item.id}/groupId`);
            },
          })),
        );
        record.data.items.sort(
          (a, b) =>
            a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
        );
        // Ensure a conflict snapshot includes all edge filtering and restored ancestors.
        const conflict = conflicts.find(
          (value) =>
            value.entityKind === 'board' && value.entityId === record.id,
        );
        if (conflict) conflict.resolved = structuredClone(record);
        add('template', record.data.board.templateId, '/data/board/templateId');
        for (const item of record.data.items)
          if (item.assetId)
            pin({ assetId: item.assetId }, `/data/items/${item.id}`);
        for (const slot of record.data.slots)
          pin(slot.currentPin, `/data/slots/${slot.id}/currentPin`);
        for (const revision of record.data.revisions)
          pin(revision.pin, `/data/revisions/${revision.id}/pin`);
        for (const selection of record.data.finalSelections)
          pin(selection, `/data/finalSelections/${selection.id}`);
        break;
      }
      case 'brand':
        for (const child of [...record.data.fonts, ...record.data.logos])
          pin(child.pin, `/data/pins/${child.id}`);
        break;
      case 'cmf':
        for (const child of record.data.entries)
          pin(child.pin, `/data/entries/${child.id}`);
        break;
      case 'generationJob':
        for (const id of record.data.assetIds)
          add('asset', id, '/data/assetIds');
        break;
      case 'activity':
        add('asset', record.data.assetId, '/data/assetId');
        break;
      case 'automationJob':
        for (const value of record.data.pins) pin(value, '/data/pins');
        for (const result of record.data.results) {
          pin(result, '/data/results');
          add(
            'automationProposal',
            result.proposalId,
            '/data/results/proposalId',
          );
        }
        break;
      case 'automationProposal':
        pin(record.data, '/data/assetId');
        add('automationJob', record.data.jobId, '/data/jobId');
        for (const id of record.data.changeIds)
          add('automationChange', id, '/data/changeIds');
        break;
      case 'automationChange':
        pin(record.data, '/data/assetId');
        add('automationProposal', record.data.proposalId, '/data/proposalId');
        break;
      case 'scriptBreakdown':
        pin(record.data.sourcePin, '/data/sourcePin');
        break;
      case 'settingDocument':
        for (const source of record.data.sources) pin(source, '/data/sources');
        break;
      // Collection/archive filters and copied automation/script audit references
      // are intentionally weak; they must not resurrect deleted records.
    }
    for (const dependency of dependencies) {
      const key = `${dependency.kind}:${dependency.id}`;
      if (resolved.has(key)) continue;
      const retained = local.get(key);
      if (retained) {
        const restored = structuredClone(retained);
        resolved.set(key, restored);
        records.push(restored);
        log(restored, `/required-by/${recordKey(record)}`);
      } else if (base.has(key) && remote.has(key) && dependency.clear) {
        dependency.clear();
        log(record, dependency.path);
      }
    }
  }
  resolveParentCycles(
    records
      .filter((record) => record.kind === 'folder')
      .map((record) => {
        const ours = local.get(recordKey(record));
        return {
          id: record.id,
          parent: record.data.parentId,
          localParent: ours?.kind === 'folder' ? ours.data.parentId : undefined,
          restore: (parent: string | null) => {
            record.data.parentId = parent;
            log(record, '/data/parentId');
          },
        };
      }),
  );
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
      ).sort((a, b) => b.ordinal - a.ordinal);
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
      const resurrectBoard = Boolean(
        theirs.data.board.deletedAt &&
          !ours.data.board.deletedAt &&
          !equal(ours, before),
      );
      if (resurrectBoard) {
        resolved.data.board.deletedAt = null;
        fields.add('/data/board/deletedAt');
      }
      const revisions: S.SlotRevision[] = [];
      for (const slot of resolved.data.slots) {
        const own = ours.data.slots.find((value) => value.id === slot.id);
        const previous =
          before?.kind === 'board'
            ? before.data.slots.find((value) => value.id === slot.id)
            : undefined;
        const incoming = theirs.data.slots.find(
          (value) => value.id === slot.id,
        );
        if (resolved.data.board.deletedAt || own?.deletedAt) {
          slot.deletedAt =
            own?.deletedAt ?? slot.deletedAt ?? resolved.data.board.deletedAt;
          slot.currentPin = null;
        } else if (
          own &&
          !own.deletedAt &&
          (resurrectBoard || (incoming?.deletedAt && !equal(own, previous)))
        ) {
          slot.deletedAt = null;
          slot.currentPin = structuredClone(own.currentPin);
          fields.add(`/data/slots/${slot.id}/deletedAt`);
          fields.add(`/data/slots/${slot.id}/currentPin`);
        }
        if (!slot.deletedAt && resolved.data.board.kind === 'matrix') {
          for (const [axis, id] of [
            ['rows', slot.rowId],
            ['columns', slot.columnId],
          ] as const) {
            if (
              !id ||
              resolved.data.board[axis].some((value) => value.id === id)
            )
              continue;
            const retained = ours.data.board[axis].find(
              (value) => value.id === id,
            );
            if (retained) {
              const position = ours.data.board[axis].findIndex(
                (value) => value.id === id,
              );
              resolved.data.board[axis].splice(
                position,
                0,
                structuredClone(retained),
              );
              fields.add(`/data/board/${axis}/${id}`);
            }
          }
        }
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
            actor: { kind: 'system', reason: 'sync-resolution' },
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
    if (
      competing &&
      resolved &&
      ours &&
      theirs &&
      'revision' in resolved.data &&
      'revision' in ours.data &&
      'revision' in theirs.data
    ) {
      resolved.data.revision =
        Math.max(ours.data.revision, theirs.data.revision) + 1;
    }
    if (resolved) resolved = S.PortableRecordSchema.parse(resolved);
    if (competing) {
      const entity = ours ?? theirs ?? before!,
        date = [ours, theirs, before]
          .flatMap((value) => {
            if (!value) return [];
            const data =
              value.kind === 'asset'
                ? value.data.asset
                : value.kind === 'board'
                  ? value.data.board
                  : value.data;
            return [data.updatedAt];
          })
          .sort()
          .at(-1)!;
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
  closeDependencies(
    libraryId,
    linkId,
    operationId,
    records,
    conflicts,
    b,
    l,
    r,
  );
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
