import * as S from '@cura/shared';
import type { AppDatabase } from '../database.js';
import { invalidGraph } from './errors.js';
import { recordKey } from './portable.js';

/** Validate the complete staged graph, including dependencies outside the current change batch. */
export function validateGraph(
  database: AppDatabase,
  libraryId: string,
  input: readonly S.PortableRecord[],
): S.PortableRecord[] {
  const records = input.map((record) => S.PortableRecordSchema.parse(record));
  if (
    records.length > 10000 ||
    Buffer.byteLength(JSON.stringify(records)) > 16 * 1024 * 1024
  )
    invalidGraph(
      'Library metadata exceeds the supported sync transaction limit',
    );
  const byKey = new Map<string, S.PortableRecord>(),
    versions = new Map<string, S.PortableVersion>(),
    seen = new Set<string>();
  const unique = (table: string, id: string) => {
    const key = `${table}:${id}`;
    if (seen.has(key)) invalidGraph('Duplicate domain identity');
    seen.add(key);
  };
  const sameLibrary = (entity: { libraryId: string }) => {
    if (entity.libraryId !== libraryId) invalidGraph('Cross-library record');
  };
  const own = (table: string, id: string) => {
    const row = database.sqlite
      .prepare(`SELECT library_id FROM ${table} WHERE id=?`)
      .get(id) as { library_id: string } | undefined;
    if (row && row.library_id !== libraryId)
      invalidGraph('An identity already belongs to another local library');
  };
  const exists = (kind: S.PortableRecord['kind'], id: string) =>
    byKey.has(`${kind}:${id}`);
  for (const record of records) {
    if (record.libraryId !== libraryId || byKey.has(recordKey(record)))
      invalidGraph('Duplicate or cross-library portable identity');
    byKey.set(recordKey(record), record);
    if (record.kind === 'automationJob' || record.kind === 'generationJob') {
      const table =
        record.kind === 'automationJob' ? 'automation_jobs' : 'generation_jobs';
      const existing = database.sqlite
        .prepare(`SELECT payload FROM ${table} WHERE id=?`)
        .get(record.id) as { payload: string } | undefined;
      if (
        existing &&
        ['queued', 'running'].includes(
          (JSON.parse(existing.payload) as { status: string }).status,
        )
      )
        invalidGraph(
          'Incoming history cannot replace an active device-local job',
        );
    }
    const entity =
      record.kind === 'asset'
        ? record.data.asset
        : record.kind === 'board'
          ? record.data.board
          : record.data;
    if (entity.id !== record.id)
      invalidGraph('Envelope identity does not match payload');
    if ('libraryId' in entity) sameLibrary(entity);
  }
  if (!exists('library', libraryId)) invalidGraph('Library record is missing');
  for (const record of records) {
    if (record.kind === 'asset') {
      const {
        asset,
        versions: items,
        annotations,
        tagLinks,
        manualSelection,
      } = record.data;
      own('assets', asset.id);
      if (asset.folderId && !exists('folder', asset.folderId))
        invalidGraph('Asset folder is missing');
      for (const version of items) {
        unique('versions', version.id);
        if (version.assetId !== asset.id)
          invalidGraph('Version belongs to a different asset');
        if (version.ordinal > 10000000)
          invalidGraph('Version ordinal is outside supported range');
        versions.set(version.id, version);
        const generation = byKey.get(`generation:${version.generationId}`);
        if (
          generation?.kind !== 'generation' ||
          generation.data.hash !== version.hash
        )
          invalidGraph(
            'Recorded generation is missing or has a different output hash',
          );
        const old = database.sqlite
          .prepare('SELECT asset_id,payload FROM asset_versions WHERE id=?')
          .get(version.id) as { asset_id: string; payload: string } | undefined;
        if (old) {
          const previous = S.AssetVersionSchema.parse(JSON.parse(old.payload));
          if (
            old.asset_id !== asset.id ||
            previous.hash !== version.hash ||
            previous.size !== version.size ||
            previous.generationId !== version.generationId
          )
            invalidGraph('An immutable version identity changed');
        }
      }
      const ordinals = items.map((v) => v.ordinal);
      if (new Set(ordinals).size !== ordinals.length)
        invalidGraph('Duplicate version ordinal');
      for (const old of database.sqlite
        .prepare('SELECT id FROM asset_versions WHERE asset_id=?')
        .all(asset.id) as Array<{ id: string }>)
        if (!items.some((v) => v.id === old.id))
          invalidGraph('Retained version history cannot be removed');
      const current = items.find((v) => v.id === asset.currentVersionId);
      if (
        !current ||
        current.hash !== asset.hash ||
        current.size !== asset.size ||
        current.generationId !== asset.generationId
      )
        invalidGraph('Current asset does not match its exact retained version');
      for (const annotation of annotations) {
        unique('annotations', annotation.id);
        if (
          annotation.assetId !== asset.id ||
          !items.some((v) => v.id === annotation.versionId)
        )
          invalidGraph('Annotation version does not belong to its asset');
      }
      for (const link of tagLinks) {
        unique(`asset-tags-${asset.id}`, link.tagId);
        if (link.assetId !== asset.id || !exists('tag', link.tagId))
          invalidGraph('Tag link is missing or cross-library');
      }
      if (
        manualSelection &&
        (manualSelection.ownerKind !== 'manual' ||
          manualSelection.ownerId !== asset.id ||
          manualSelection.assetId !== asset.id)
      )
        invalidGraph('Manual owner mismatch');
    }
  }
  const pin = (value: { assetId: string; versionId: string } | null) => {
    if (
      value &&
      (!exists('asset', value.assetId) ||
        versions.get(value.versionId)?.assetId !== value.assetId)
    )
      invalidGraph('Exact pin is missing or belongs to another asset');
  };
  const final = (selection: S.FinalSelection) => {
    sameLibrary(selection);
    unique('final_selections', selection.id);
    pin(selection);
  };
  const acyclic = (nodes: Array<{ id: string; parent: string | null }>) => {
    const map = new Map(nodes.map((n) => [n.id, n.parent]));
    for (const node of nodes) {
      const visited = new Set<string>();
      let id: string | null = node.id;
      while (id) {
        if (visited.has(id)) invalidGraph('Parent cycle');
        visited.add(id);
        if (!map.has(id)) invalidGraph('Parent reference is missing');
        id = map.get(id) ?? null;
      }
    }
  };
  acyclic(
    records
      .filter((r) => r.kind === 'folder')
      .map((r) => ({ id: r.id, parent: r.data.parentId })),
  );
  const tables: Partial<Record<S.PortableRecord['kind'], string>> = {
    folder: 'folders',
    tagGroup: 'tag_groups',
    tag: 'tags',
    collection: 'collections',
    template: 'slot_templates',
    board: 'boards',
    brand: 'brands',
    cmf: 'cmf_boards',
    generation: 'recorded_generations',
    generationJob: 'generation_jobs',
    activity: 'activity',
    automationJob: 'automation_jobs',
    automationProposal: 'automation_proposals',
    automationChange: 'automation_changes',
    archiveRule: 'archive_rules',
    scriptBreakdown: 'script_breakdowns',
    settingDocument: 'setting_documents',
  };
  for (const record of records) {
    const table = tables[record.kind];
    if (table) own(table, record.id);
    switch (record.kind) {
      case 'asset':
        if (record.data.manualSelection) final(record.data.manualSelection);
        break;
      case 'tag':
        if (record.data.groupId && !exists('tagGroup', record.data.groupId))
          invalidGraph('Tag group is missing');
        break;
      case 'board': {
        const { board, items, edges, slots, revisions, finalSelections } =
          record.data;
        if (board.templateId && !exists('template', board.templateId))
          invalidGraph('Board template is missing');
        const nodes = new Map(items.map((i) => [i.id, i])),
          slotMap = new Map(slots.map((s) => [s.id, s]));
        acyclic(items.map((i) => ({ id: i.id, parent: i.groupId })));
        for (const item of items) {
          sameLibrary(item);
          unique('board_items', item.id);
          own('board_items', item.id);
          if (item.boardId !== board.id)
            invalidGraph('Board item parent mismatch');
          if (item.groupId && nodes.get(item.groupId)?.kind !== 'group')
            invalidGraph('Parent item is not a group');
          if (item.kind === 'asset') {
            if (!item.assetId || !item.versionId)
              invalidGraph('Asset item requires an exact pin');
            pin({ assetId: item.assetId, versionId: item.versionId });
          } else if (item.assetId || item.versionId)
            invalidGraph('Non-asset item contains a pin');
        }
        for (const edge of edges) {
          sameLibrary(edge);
          unique('board_edges', edge.id);
          own('board_edges', edge.id);
          if (
            edge.boardId !== board.id ||
            !nodes.has(edge.sourceId) ||
            !nodes.has(edge.targetId)
          )
            invalidGraph('Edge endpoints are not in the board');
        }
        for (const slot of slots) {
          sameLibrary(slot);
          unique('slots', slot.id);
          own('slots', slot.id);
          if (slot.boardId !== board.id) invalidGraph('Slot board mismatch');
          pin(slot.currentPin);
          if (slot.deletedAt && slot.currentPin)
            invalidGraph('Deleted slot retains a current pin');
          if (
            !slot.deletedAt &&
            board.kind === 'matrix' &&
            (!board.rows.some((r) => r.id === slot.rowId) ||
              !board.columns.some((c) => c.id === slot.columnId))
          )
            invalidGraph('Matrix cell axis is missing');
          const history = revisions.filter((r) => r.slotId === slot.id);
          if (new Set(history.map((r) => r.ordinal)).size !== history.length)
            invalidGraph('Duplicate slot ordinal');
          if (slot.revision !== Math.max(0, ...history.map((r) => r.ordinal)))
            invalidGraph('Slot revision does not match retained history');
          const latest = history.find((r) => r.ordinal === slot.revision);
          if (
            latest &&
            JSON.stringify(latest.pin) !== JSON.stringify(slot.currentPin)
          )
            invalidGraph('Current slot pin disagrees with latest history');
        }
        for (const revision of revisions) {
          sameLibrary(revision);
          unique('slot_revisions', revision.id);
          own('slot_revisions', revision.id);
          if (!slotMap.has(revision.slotId))
            invalidGraph('Slot history parent missing');
          pin(revision.pin);
          const old = database.sqlite
            .prepare(
              'SELECT asset_id,version_id,slot_id FROM slot_revisions WHERE id=?',
            )
            .get(revision.id) as
            | {
                asset_id: string | null;
                version_id: string | null;
                slot_id: string;
              }
            | undefined;
          if (
            old &&
            (old.slot_id !== revision.slotId ||
              old.asset_id !== (revision.pin?.assetId ?? null) ||
              old.version_id !== (revision.pin?.versionId ?? null))
          )
            invalidGraph('An immutable slot revision pin changed');
        }
        for (const old of database.sqlite
          .prepare(
            'SELECT r.id FROM slot_revisions r JOIN slots s ON s.id=r.slot_id WHERE s.board_id=?',
          )
          .all(board.id) as Array<{ id: string }>)
          if (!revisions.some((r) => r.id === old.id))
            invalidGraph('Slot history cannot be removed');
        for (const selection of finalSelections) {
          final(selection);
          const slot = slotMap.get(selection.ownerId);
          if (
            selection.ownerKind !== 'slot' ||
            !slot ||
            slot.deletedAt ||
            slot.currentPin?.assetId !== selection.assetId ||
            slot.currentPin.versionId !== selection.versionId
          )
            invalidGraph('Final slot owner mismatch');
        }
        for (const slot of slots)
          if (
            Boolean(slot.currentPin) !==
            finalSelections.some((s) => s.ownerId === slot.id)
          )
            invalidGraph('Final slot ownership is incomplete');
        break;
      }
      case 'brand':
        for (const child of [
          ...record.data.colors,
          ...record.data.fonts,
          ...record.data.logos,
        ]) {
          if (child.brandId !== record.id) invalidGraph('Brand child mismatch');
          if ('pin' in child) pin(child.pin);
        }
        break;
      case 'cmf':
        for (const entry of record.data.entries) {
          if (entry.boardId !== record.id) invalidGraph('CMF child mismatch');
          pin(entry.pin);
        }
        break;
      case 'generationJob':
        for (const id of record.data.assetIds)
          if (!exists('asset', id)) invalidGraph('Job output missing');
        break;
      case 'activity':
        if (record.data.assetId && !exists('asset', record.data.assetId))
          invalidGraph('Activity asset missing');
        break;
      case 'automationJob':
        for (const value of record.data.pins) pin(value);
        for (const result of record.data.results) {
          pin(result);
          if (
            result.proposalId &&
            !exists('automationProposal', result.proposalId)
          )
            invalidGraph('Automation result proposal missing');
        }
        break;
      case 'automationProposal':
        pin(record.data);
        if (
          !exists('automationJob', record.data.jobId) ||
          record.data.changeIds.some((id) => !exists('automationChange', id))
        )
          invalidGraph('Automation proposal closure missing');
        break;
      case 'automationChange':
        pin(record.data);
        if (!exists('automationProposal', record.data.proposalId))
          invalidGraph('Automation change parent missing');
        break;
      case 'scriptBreakdown':
        pin(record.data.sourcePin);
        break;
      case 'settingDocument':
        for (const source of record.data.sources) pin(source);
        break;
    }
  }
  return records;
}
