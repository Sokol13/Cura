import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import * as S from '@cura/shared';
import type { AppDatabase } from '../database.js';
import type { UserPaths } from '../paths.js';
import { CatalogStore } from '../catalog-store.js';
import { portableName } from '../exports/portable.js';
import { validateGraph } from './validate.js';
import { invalidGraph } from './errors.js';
import { semanticHash, readPortableGraph } from './portable.js';

type Value = string | number | null;
export interface ReplayOptions {
  expectedLocalHash?: string;
  managedRootId?: string;
}
/** Retained bytes must be verified before this transaction. Local source aliases are never written. */
export function replayPortableGraph(
  database: AppDatabase,
  paths: UserPaths,
  libraryId: string,
  input: readonly S.PortableRecord[],
  options: ReplayOptions = {},
): { managedRootId: string; protectedAssets: string[] } {
  return database.sqlite.transaction(() => {
    const existing = database.sqlite
      .prepare('SELECT id FROM libraries WHERE id=?')
      .get(libraryId);
    if (options.expectedLocalHash !== undefined) {
      const actual = existing
        ? semanticHash(readPortableGraph(database, libraryId).records)
        : semanticHash([]);
      if (actual !== options.expectedLocalHash)
        throw Object.assign(
          new Error('Local work changed during sync; retrying safely'),
          { code: 'SYNC_LOCAL_CHANGED', statusCode: 409 },
        );
    }
    const records = validateGraph(database, libraryId, input);
    const byKind = <K extends S.PortableRecord['kind']>(kind: K) =>
      records.filter(
        (r): r is Extract<S.PortableRecord, { kind: K }> => r.kind === kind,
      );
    const run = (sql: string, ...values: Value[]) =>
      database.sqlite.prepare(sql).run(...values);
    const put = (table: string, values: Record<string, Value>) => {
      const keys = Object.keys(values);
      run(
        `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${keys
          .filter((k) => k !== 'id')
          .map((k) => `${k}=excluded.${k}`)
          .join(',')}`,
        ...Object.values(values),
      );
    };
    const insert = (table: string, values: Record<string, Value>) => {
      const keys = Object.keys(values);
      run(
        `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
        ...Object.values(values),
      );
    };
    const dates = (value: { createdAt: string; updatedAt: string }) => ({
      created_at: value.createdAt,
      updated_at: value.updatedAt,
    });
    const entity = (value: {
      id: string;
      libraryId: string;
      createdAt: string;
      updatedAt: string;
    }) => ({ id: value.id, library_id: value.libraryId, ...dates(value) });
    const library = byKind('library')[0]!.data;
    if (library.id !== libraryId) invalidGraph('Library identity mismatch');
    put('libraries', { id: library.id, name: library.name, ...dates(library) });
    let root = database.sqlite
      .prepare(
        'SELECT id FROM library_roots WHERE library_id=? AND managed=1 AND removed_at IS NULL',
      )
      .get(libraryId) as { id: string } | undefined;
    if (!root) {
      root = { id: options.managedRootId ?? randomUUID() };
      insert('library_roots', {
        id: root.id,
        library_id: libraryId,
        path: join(paths.data, 'libraries', libraryId, 'Sync'),
        kind: 'inbox',
        removed_at: null,
        managed: 1,
        ...dates(library),
      });
    }
    const removeAbsent = (table: string, ids: string[], where = '') => {
      const rows = database.sqlite
        .prepare(`SELECT id FROM ${table} WHERE library_id=? ${where}`)
        .all(libraryId) as Array<{ id: string }>;
      const keep = new Set(ids);
      for (const row of rows)
        if (!keep.has(row.id)) run(`DELETE FROM ${table} WHERE id=?`, row.id);
    };
    for (const old of database.sqlite
      .prepare('SELECT id FROM assets WHERE library_id=?')
      .all(libraryId) as Array<{ id: string }>)
      if (!byKind('asset').some((r) => r.id === old.id))
        invalidGraph(
          'Assets must use logical trash; retained bytes cannot be hard-deleted',
        );
    run('DELETE FROM final_selections WHERE library_id=?', libraryId);
    // Remove only terminal automation history; active jobs/proposals are device-local.
    const portableProposalIds = (
      database.sqlite
        .prepare(
          "SELECT p.id FROM automation_proposals p JOIN automation_jobs j ON j.id=p.job_id WHERE p.library_id=? AND json_extract(j.payload,'$.status') NOT IN ('queued','running')",
        )
        .all(libraryId) as Array<{ id: string }>
    ).map((r) => r.id);
    for (const id of portableProposalIds) {
      run('DELETE FROM automation_changes WHERE proposal_id=?', id);
      run('DELETE FROM automation_proposals WHERE id=?', id);
    }
    removeAbsent(
      'automation_jobs',
      byKind('automationJob').map((r) => r.id),
      "AND json_extract(payload,'$.status') NOT IN ('queued','running')",
    );
    for (const [kind, table] of [
      ['brand', 'brands'],
      ['cmf', 'cmf_boards'],
      ['collection', 'collections'],
      ['tag', 'tags'],
      ['tagGroup', 'tag_groups'],
      ['folder', 'folders'],
      ['activity', 'activity'],
      ['archiveRule', 'archive_rules'],
      ['scriptBreakdown', 'script_breakdowns'],
      ['settingDocument', 'setting_documents'],
    ] as const)
      removeAbsent(
        table,
        byKind(kind).map((r) => r.id),
      );
    for (const { data: d } of byKind('tagGroup'))
      put('tag_groups', { ...entity(d), name: d.name });
    for (const { data: d } of byKind('folder'))
      put('folders', { ...entity(d), name: d.name, parent_id: null });
    for (const { data: d } of byKind('folder'))
      run('UPDATE folders SET parent_id=? WHERE id=?', d.parentId, d.id);
    for (const { data: d } of byKind('tag'))
      put('tags', {
        ...entity(d),
        name: d.name,
        color: d.color,
        group_id: d.groupId,
      });
    for (const { data: d } of byKind('collection'))
      put('collections', {
        ...entity(d),
        name: d.name,
        rules: JSON.stringify(d.rules),
      });
    for (const { data: d } of byKind('generation'))
      put('recorded_generations', {
        ...entity(d),
        hash: d.hash,
        source: d.source,
        model: d.model,
        origin: d.origin,
      });
    for (const { data: d } of byKind('asset')) {
      const a = d.asset,
        previous = database.sqlite
          .prepare(
            'SELECT root_id,relative_path,payload FROM assets WHERE id=?',
          )
          .get(a.id) as
          | { root_id: string; relative_path: string; payload: string }
          | undefined;
      const old = previous
        ? (JSON.parse(previous.payload) as Record<string, unknown>)
        : {};
      const nextPreview =
        old.currentVersionId === a.currentVersionId
          ? old
          : (JSON.parse(
              (
                database.sqlite
                  .prepare('SELECT payload FROM asset_versions WHERE id=?')
                  .get(a.currentVersionId) as { payload: string } | undefined
              )?.payload ?? '{}',
            ) as Record<string, unknown>);
      const local = {
        rootId: previous?.root_id ?? root.id,
        relativePath:
          previous?.relative_path ?? join(a.id, portableName(a.name)),
        previewState: nextPreview.previewState ?? 'pending',
        previewRevision: nextPreview.previewRevision ?? 0,
        previewError: nextPreview.previewError ?? null,
      };
      const payload = { ...a, ...local, tags: [], finalized: false };
      put('assets', {
        id: a.id,
        library_id: libraryId,
        root_id: local.rootId,
        relative_path: local.relativePath,
        current_hash: a.hash,
        folder_id: a.folderId,
        deleted_at: a.deletedAt,
        payload: JSON.stringify(payload),
        ...dates(a),
      });
      run(
        'UPDATE asset_versions SET ordinal=ordinal+100000000 WHERE asset_id=?',
        a.id,
      );
      for (const v of d.versions) {
        const prior = database.sqlite
          .prepare(
            'SELECT snapshot_path,thumbnail_path,payload FROM asset_versions WHERE id=?',
          )
          .get(v.id) as
          | {
              snapshot_path: string;
              thumbnail_path: string | null;
              payload: string;
            }
          | undefined;
        const priorValue = prior
          ? (JSON.parse(prior.payload) as Record<string, unknown>)
          : {};
        const value = {
          ...v,
          previewState: priorValue.previewState ?? 'pending',
          previewRevision: priorValue.previewRevision ?? 0,
          previewError: priorValue.previewError ?? null,
        };
        put('asset_versions', {
          id: v.id,
          asset_id: v.assetId,
          ordinal: v.ordinal,
          payload: JSON.stringify(value),
          snapshot_path:
            prior?.snapshot_path ?? join(paths.data, 'objects', v.hash),
          thumbnail_path: prior?.thumbnail_path ?? null,
          ...dates(v),
        });
      }
      run('DELETE FROM annotations WHERE asset_id=?', a.id);
      for (const value of d.annotations)
        insert('annotations', {
          id: value.id,
          asset_id: a.id,
          version_id: value.versionId,
          x: value.x,
          y: value.y,
          text: value.text,
          ...dates(value),
        });
      run('DELETE FROM asset_tags WHERE asset_id=?', a.id);
      for (const value of d.tagLinks)
        insert('asset_tags', {
          asset_id: a.id,
          tag_id: value.tagId,
          ...dates(value),
        });
    }
    for (const { data: d } of byKind('template'))
      put('slot_templates', {
        ...entity(d),
        name: d.name,
        preset: d.preset,
        slots_json: JSON.stringify(d.slots),
        deleted_at: d.deletedAt,
      });
    // Boards use soft deletion; preserve all slot history identities while replacing mutable layouts.
    for (const { data: d } of byKind('board')) {
      const b = d.board;
      put('boards', {
        ...entity(b),
        name: b.name,
        kind: b.kind,
        revision: b.revision,
        viewport: JSON.stringify(b.viewport),
        rows_json: JSON.stringify(b.rows),
        columns_json: JSON.stringify(b.columns),
        template_id: b.templateId,
        deleted_at: b.deletedAt,
      });
      run('DELETE FROM board_edges WHERE board_id=?', b.id);
      run('DELETE FROM board_items WHERE board_id=?', b.id);
      run(
        'DELETE FROM slot_revisions WHERE slot_id IN (SELECT id FROM slots WHERE board_id=?)',
        b.id,
      );
      run('DELETE FROM slots WHERE board_id=?', b.id);
      for (const i of d.items)
        insert('board_items', {
          ...entity(i),
          board_id: b.id,
          kind: i.kind,
          x: i.x,
          y: i.y,
          width: i.width,
          height: i.height,
          group_id: null,
          label: i.label,
          text: i.text,
          asset_id: i.assetId,
          version_id: i.versionId,
        });
      for (const i of d.items)
        run('UPDATE board_items SET group_id=? WHERE id=?', i.groupId, i.id);
      for (const e of d.edges)
        insert('board_edges', {
          ...entity(e),
          board_id: b.id,
          source_id: e.sourceId,
          target_id: e.targetId,
          label: e.label,
        });
      for (const s of d.slots)
        insert('slots', {
          ...entity(s),
          board_id: b.id,
          label: s.label,
          x: s.x,
          y: s.y,
          width: s.width,
          height: s.height,
          row_id: s.rowId,
          column_id: s.columnId,
          template_key: s.templateKey,
          revision: s.revision,
          asset_id: s.currentPin?.assetId ?? null,
          version_id: s.currentPin?.versionId ?? null,
          deleted_at: s.deletedAt,
        });
      for (const r of d.revisions)
        insert('slot_revisions', {
          ...entity(r),
          slot_id: r.slotId,
          ordinal: r.ordinal,
          asset_id: r.pin?.assetId ?? null,
          version_id: r.pin?.versionId ?? null,
        });
    }
    for (const { data: d } of byKind('brand')) {
      put('brands', {
        ...entity(d),
        name: d.name,
        guidelines: d.guidelines,
        revision: d.revision,
      });
      for (const table of ['brand_colors', 'brand_fonts', 'brand_logos'])
        run(`DELETE FROM ${table} WHERE brand_id=?`, d.id);
      for (const c of d.colors)
        insert('brand_colors', {
          id: c.id,
          brand_id: d.id,
          name: c.name,
          hex: c.hex,
          position: c.position,
          ...dates(c),
        });
      for (const f of d.fonts)
        insert('brand_fonts', {
          id: f.id,
          brand_id: d.id,
          name: f.name,
          role: f.role,
          asset_id: f.pin.assetId,
          version_id: f.pin.versionId,
          position: f.position,
          ...dates(f),
        });
      for (const l of d.logos)
        insert('brand_logos', {
          id: l.id,
          brand_id: d.id,
          name: l.name,
          asset_id: l.pin.assetId,
          version_id: l.pin.versionId,
          position: l.position,
          ...dates(l),
        });
    }
    for (const { data: d } of byKind('cmf')) {
      put('cmf_boards', { ...entity(d), name: d.name, revision: d.revision });
      run('DELETE FROM cmf_entries WHERE board_id=?', d.id);
      for (const e of d.entries)
        insert('cmf_entries', {
          id: e.id,
          board_id: d.id,
          name: e.name,
          color_name: e.colorName,
          hex: e.hex,
          process: e.process,
          asset_id: e.pin.assetId,
          version_id: e.pin.versionId,
          position: e.position,
          ...dates(e),
        });
    }
    for (const { data: d } of byKind('generationJob'))
      put('generation_jobs', { ...entity(d), payload: JSON.stringify(d) });
    removeAbsent(
      'generation_jobs',
      byKind('generationJob').map((r) => r.id),
      "AND json_extract(payload,'$.status') NOT IN ('queued','running')",
    );
    for (const { data: d } of byKind('activity'))
      put('activity', {
        ...entity(d),
        asset_id: d.assetId,
        action: d.action,
        details: JSON.stringify(d.details),
      });
    for (const { data: d } of byKind('automationJob'))
      put('automation_jobs', { ...entity(d), payload: JSON.stringify(d) });
    for (const { data: d } of byKind('automationProposal'))
      put('automation_proposals', {
        ...entity(d),
        job_id: d.jobId,
        asset_id: d.assetId,
        version_id: d.versionId,
        payload: JSON.stringify(d),
      });
    for (const { data: d } of byKind('automationChange'))
      put('automation_changes', {
        ...entity(d),
        proposal_id: d.proposalId,
        asset_id: d.assetId,
        version_id: d.versionId,
        field: d.field,
        payload: JSON.stringify(d),
      });
    for (const { data: d } of byKind('archiveRule'))
      put('archive_rules', { ...entity(d), payload: JSON.stringify(d) });
    for (const { data: d } of byKind('scriptBreakdown'))
      put('script_breakdowns', {
        ...entity(d),
        asset_id: d.sourcePin.assetId,
        version_id: d.sourcePin.versionId,
        payload: JSON.stringify(d),
      });
    for (const { data: d } of byKind('settingDocument'))
      put('setting_documents', { ...entity(d), payload: JSON.stringify(d) });
    const selections = [
      ...byKind('asset').flatMap((r) =>
        r.data.manualSelection ? [r.data.manualSelection] : [],
      ),
      ...byKind('board').flatMap((r) => r.data.finalSelections),
    ];
    for (const s of selections)
      insert('final_selections', {
        ...entity(s),
        owner_kind: s.ownerKind,
        owner_id: s.ownerId,
        asset_id: s.assetId,
        version_id: s.versionId,
      });
    const protectedAssets: string[] = [];
    for (const {
      data: { asset: a },
    } of byKind('asset')) {
      const owned = selections.filter((s) => s.assetId === a.id);
      if (owned.length && a.archivedAt) protectedAssets.push(a.id);
      run(
        "UPDATE assets SET payload=json_set(payload,'$.finalized',json(?),'$.archivedAt',?) WHERE id=?",
        JSON.stringify(
          owned.some(
            (s) =>
              s.ownerKind === 'manual' && s.versionId === a.currentVersionId,
          ),
        ),
        owned.length ? null : a.archivedAt,
        a.id,
      );
    }
    const catalog = new CatalogStore(database);
    // Root provides the projection-only hook; no ordinary mutation method is called.
    catalog.refreshAssetSearch(byKind('asset').map((r) => r.id));
    return { managedRootId: root.id, protectedAssets };
  })();
}
