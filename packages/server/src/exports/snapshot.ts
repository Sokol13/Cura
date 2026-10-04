import * as C from '@cura/shared';
import type { AppDatabase } from '../database.js';
import { CatalogError, CatalogStore } from '../catalog-store.js';
import { BoardStore } from '../boards/store.js';
import { readBrandExport } from '../brands/store.js';
import { readProcessExport } from '../process/store.js';
import { readAutomationExport } from '../automation/export.js';
import { readFcpxmlExport } from '../fcpxml/snapshot.js';
import { portableName } from './portable.js';
type Row = Record<string, unknown>;
const camel = (row: Row): Row =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );
export interface SnapshotFile {
  path: string;
  source: string;
  hash: string;
  size: number;
  versionIds: string[];
  assetIds: string[];
}
export interface ExportSnapshot {
  manifest: C.ExportManifest;
  files: SnapshotFile[];
  folder: string;
}
/** One read transaction, complete domain readers, no public asset pagination. */
export function readExportSnapshot(
  database: AppDatabase,
  libraryId: string,
  input: C.ExportRequest,
): ExportSnapshot {
  const request = C.ExportRequestSchema.parse(input),
    catalog = new CatalogStore(database);
  const rows = (sql: string, ...parameters: string[]) =>
    database.sqlite.prepare(sql).all(...parameters) as Row[];
  return database.sqlite.transaction(() => {
    const library = catalog.getLibrary(libraryId);
    const boards = new BoardStore(database).exportLibrary(libraryId),
      brands = readBrandExport(database, libraryId),
      process = readProcessExport(database, libraryId);
    const automation = readAutomationExport(database, libraryId);
    const fcpxml = readFcpxmlExport(database, libraryId);
    const syncConflicts = rows(
      'SELECT c.payload FROM sync_conflicts c JOIN sync_links l ON l.id=c.link_id WHERE l.library_id=? ORDER BY c.created_at,c.id',
      libraryId,
    ).map((row) =>
      C.SyncConflictDetailSchema.parse(JSON.parse(String(row.payload))),
    );
    const allIds = rows(
      'SELECT id FROM assets WHERE library_id=? ORDER BY created_at,id',
      libraryId,
    ).map((row) => String(row.id));
    const chosen = new Set(
      request.scope === 'library' ? allIds : request.assetIds,
    );
    if (request.assetIds.some((id) => !allIds.includes(id)))
      throw new CatalogError(
        'Selected assets must belong to this library',
        'INVALID_RELATION',
        400,
      );
    // Retain complete board/brand structures and every current and historical pin.
    for (const pin of [
      ...brands.pins,
      ...boards.items,
      ...boards.slots.map((slot) => slot.currentPin),
      ...boards.revisions.map((revision) => revision.pin),
      ...automation.pins,
      ...fcpxml.flatMap((job) => job.request.clips),
    ])
      if (pin?.assetId) chosen.add(pin.assetId);
    // Conflict snapshots remain historical metadata. Include referenced live assets
    // when they still exist; deleted historical records remain in the snapshots.
    const conflictDependencies = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(conflictDependencies);
        return;
      }
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      if (
        record.kind === 'asset' &&
        typeof record.id === 'string' &&
        allIds.includes(record.id)
      )
        chosen.add(record.id);
      if (typeof record.assetId === 'string' && allIds.includes(record.assetId))
        chosen.add(record.assetId);
      for (const child of Object.values(record)) conflictDependencies(child);
    };
    syncConflicts.forEach(conflictDependencies);
    const collections = catalog.listCollections(libraryId);
    for (const collection of collections)
      if (collection.rules.similarTo) chosen.add(collection.rules.similarTo);
    // A multi-output job is one provenance record; retain all of its output references.
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const job of process.jobs)
        if (job.assetIds.some((id) => chosen.has(id)))
          for (const id of job.assetIds)
            if (!chosen.has(id)) {
              chosen.add(id);
              expanded = true;
            }
    }
    const assets = allIds
      .filter((id) => chosen.has(id))
      .map((id) => catalog.getAsset(id));
    const versions = assets.flatMap((asset) => catalog.listVersions(asset.id));
    const includedGenerations = new Set(
      versions.map((version) => version.generationId),
    );
    const files: SnapshotFile[] = [];
    const byHash = new Map<string, SnapshotFile>();
    const mappedVersions = versions.map((version) => {
      if (!/^[a-f\d]{64}$/i.test(version.hash))
        throw new CatalogError(
          'A version has an invalid retained hash',
          'INVALID_SNAPSHOT',
          409,
        );
      let file = byHash.get(version.hash);
      if (!file) {
        file = {
          path: `files/${version.hash}/${C.versionExportName(assets.find((asset) => asset.id === version.assetId)?.displayName, version.name)}`,
          source: catalog.getVersionFile(version.id).snapshotPath,
          hash: version.hash,
          size: version.size,
          versionIds: [],
          assetIds: [],
        };
        files.push(file);
        byHash.set(version.hash, file);
      }
      if (file.size !== version.size)
        throw new CatalogError(
          'Versions with the same hash have inconsistent sizes',
          'INVALID_SNAPSHOT',
          409,
        );
      file.versionIds.push(version.id);
      file.assetIds.push(version.assetId);
      return { ...version, file: file.path };
    });
    const roots = rows(
      'SELECT * FROM library_roots WHERE library_id=? ORDER BY created_at,id',
      libraryId,
    ).map((row) => ({
      ...camel(row),
      managed: row.managed === 1,
      path:
        row.managed === 1 ? 'Sync' : row.kind === 'inbox' ? 'Inbox' : row.path,
    }));
    const sources = rows(
      'SELECT s.* FROM asset_sources s JOIN assets a ON a.id=s.asset_id WHERE a.library_id=? ORDER BY s.created_at,s.id',
      libraryId,
    )
      .filter((row) => chosen.has(String(row.asset_id)))
      .map((row) => ({ ...camel(row), available: row.available === 1 }));
    const assetTags = rows(
      'SELECT t.* FROM asset_tags t JOIN assets a ON a.id=t.asset_id WHERE a.library_id=? ORDER BY t.asset_id,t.tag_id',
      libraryId,
    )
      .filter((row) => chosen.has(String(row.asset_id)))
      .map(camel);
    const activity = rows(
      'SELECT * FROM activity WHERE library_id=? ORDER BY created_at,id',
      libraryId,
    )
      .filter(
        (row) =>
          request.scope === 'library' ||
          row.asset_id === null ||
          chosen.has(String(row.asset_id)),
      )
      .map((row) => ({
        ...camel(row),
        details: JSON.parse(String(row.details)) as unknown,
      }));
    const manifest = C.ExportManifestSchema.parse({
      format: 'cura-export/1',
      exportedAt: new Date().toISOString(),
      scope: request.scope,
      requestedAssetIds: [...new Set(request.assetIds)],
      includedDependencyAssetIds:
        request.scope === 'selection'
          ? allIds.filter(
              (id) => chosen.has(id) && !request.assetIds.includes(id),
            )
          : [],
      library,
      roots,
      assets,
      versions: mappedVersions,
      sources,
      folders: catalog.listFolders(libraryId),
      tagGroups: catalog.listTagGroups(libraryId),
      tags: catalog.listTags(libraryId),
      assetTags,
      collections,
      annotations: assets.flatMap((asset) => catalog.listAnnotations(asset.id)),
      process: {
        generations: process.generations.filter((generation) =>
          includedGenerations.has(generation.id),
        ),
        finalSelections: process.finalSelections.filter((selection) =>
          chosen.has(selection.assetId),
        ),
        jobs: process.jobs.filter(
          (job) =>
            request.scope === 'library' ||
            job.assetIds.some((id) => chosen.has(id)),
        ),
      },
      boards,
      brands,
      automation,
      syncConflicts,
      fcpxml,
      activity,
      files: files.map((file) => ({
        path: file.path,
        sha256: file.hash,
        size: file.size,
        versionIds: file.versionIds,
        type: versions.find((version) => version.id === file.versionIds[0])!
          .type,
      })),
      exceptions: [],
    });
    return {
      manifest,
      files,
      folder: `cura-${portableName(library.name)}-${library.id.slice(0, 8)}`,
    };
  })();
}
