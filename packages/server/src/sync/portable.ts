import { createHash } from 'node:crypto';
import * as S from '@cura/shared';
import type { AppDatabase } from '../database.js';
import { readExportSnapshot } from '../exports/snapshot.js';
import { BoardStore } from '../boards/store.js';
import { readBrandExport } from '../brands/store.js';
import { readAutomationExport } from '../automation/export.js';

export interface SyncFile {
  hash: string;
  size: number;
  type: string;
  source: string;
}
export interface PortableGraph {
  records: S.PortableRecord[];
  files: SyncFile[];
}
export const recordKey = (
  record: Pick<S.PortableRecord, 'kind' | 'id'>,
): string => `${record.kind}:${record.id}`;
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`;
}
export const payloadHash = (value: unknown): string =>
  createHash('sha256').update(canonical(value)).digest('hex');
function semantic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semantic);
  if (value === null || typeof value !== 'object') return value;
  // Authored params/exif/text may contain an updatedAt key: those values are semantic.
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'updatedAt')
      .map(([key, item]) => [
        key,
        ['params', 'exif', 'details', 'beforeValue', 'afterValue'].includes(key)
          ? item
          : semantic(item),
      ]),
  );
}
export const semanticHash = (value: unknown): string =>
  payloadHash(semantic(value));
const omit = (
  value: object,
  keys: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key)),
  );
const preview = ['previewState', 'previewRevision', 'previewError'];

/** A consistent read transaction; caller runs this in a worker for background synchronization. */
export function readPortableGraph(
  database: AppDatabase,
  libraryId: string,
): PortableGraph {
  return database.sqlite.transaction(() => {
    const { manifest, files } = readExportSnapshot(database, libraryId, {
      scope: 'library',
    });
    const records: S.PortableRecord[] = [];
    const add = (kind: string, id: string, data: unknown) =>
      records.push(S.PortableRecordSchema.parse({ kind, id, libraryId, data }));
    add('library', libraryId, manifest.library);
    for (const asset of manifest.assets) {
      const stored = JSON.parse(
        (
          database.sqlite
            .prepare('SELECT payload FROM assets WHERE id=?')
            .get(asset.id) as { payload: string }
        ).payload,
      ) as Record<string, unknown>;
      add('asset', asset.id, {
        asset: {
          ...omit(asset, [
            ...preview,
            'rootId',
            'relativePath',
            'missing',
            'tags',
            'finalized',
          ]),
          displayName: stored.displayName ?? null,
          archivedAt: stored.archivedAt ?? null,
        },
        versions: manifest.versions
          .filter((v) => v.assetId === asset.id)
          .map((v) => omit(v, [...preview, 'file'])),
        annotations: manifest.annotations.filter((a) => a.assetId === asset.id),
        tagLinks: manifest.assetTags.filter((t) => t.assetId === asset.id),
        manualSelection:
          manifest.process.finalSelections.find(
            (s) => s.ownerKind === 'manual' && s.ownerId === asset.id,
          ) ?? null,
      });
    }
    for (const [kind, items] of [
      ['folder', manifest.folders],
      ['tagGroup', manifest.tagGroups],
      ['tag', manifest.tags],
      ['collection', manifest.collections],
      ['generation', manifest.process.generations],
    ] as const)
      for (const item of items) add(kind, item.id, item);
    for (const job of manifest.process.jobs)
      if (!['queued', 'running'].includes(job.status))
        add('generationJob', job.id, job);
    const boards = new BoardStore(database).exportLibrary(libraryId);
    for (const template of boards.templates)
      add('template', template.id, template);
    for (const board of boards.boards) {
      const slots = boards.slots.filter((s) => s.boardId === board.id),
        ids = new Set(slots.map((s) => s.id));
      add('board', board.id, {
        board,
        items: boards.items.filter((i) => i.boardId === board.id),
        edges: boards.edges.filter((e) => e.boardId === board.id),
        slots,
        revisions: boards.revisions.filter((r) => ids.has(r.slotId)),
        finalSelections: manifest.process.finalSelections.filter(
          (s) => s.ownerKind === 'slot' && ids.has(s.ownerId),
        ),
      });
    }
    const brands = readBrandExport(database, libraryId);
    for (const brand of brands.brands)
      add('brand', brand.id, {
        ...brand,
        colors: brand.colors.map((c) => omit(c, ['rgb', 'cmyk'])),
      });
    for (const board of brands.cmfBoards) add('cmf', board.id, board);
    for (const raw of manifest.activity) {
      const activity = S.PortableActivitySchema.parse(raw);
      if (activity.action === 'ingest')
        activity.details = S.PortableActivitySchema.parse({
          ...activity,
          details: omit(activity.details, ['relativePath']),
        }).details;
      add('activity', activity.id, activity);
    }
    const automation = readAutomationExport(database, libraryId);
    for (const [kind, items] of [
      ['automationJob', automation.jobs],
      ['automationProposal', automation.proposals],
      ['automationChange', automation.changes],
      ['archiveRule', automation.rules],
      ['scriptBreakdown', automation.scripts],
      ['settingDocument', automation.documents],
    ] as const)
      for (const item of items) add(kind, item.id, item);
    records.sort((a, b) => recordKey(a).localeCompare(recordKey(b), 'en'));
    return {
      records,
      files: files.map((file) => ({
        hash: file.hash,
        size: file.size,
        source: file.source,
        type: manifest.versions.find((v) => v.hash === file.hash)!.type,
      })),
    };
  })();
}
