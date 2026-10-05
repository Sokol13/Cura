import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import type Database from 'better-sqlite3';
import * as C from '@cura/shared';
import type { AppDatabase } from './database.js';
import {
  ASSET_AVAILABLE_SQL,
  assetSearch,
  registerSearchFunctions,
} from './catalog-search.js';
import { setFinalSelection } from './process/final-selections.js';
import { ScanStore } from './media/scan-store.js';
import { InboxMigrationStore } from './media/inbox-migration-store.js';

type Row = Record<string, unknown>;
type Parser<T> = { parse: (input: unknown) => T };
export interface IngestedFile {
  hash: string;
  size: number;
  type: string;
  width: number | null;
  height: number | null;
  colors: string[];
  phash: string;
  exif: Record<string, unknown>;
  generation: C.Generation;
  snapshotPath: string;
  thumbnailPath: string | null;
}
export interface IngestInput {
  libraryId: string;
  rootId: string;
  relativePath: string;
  actualRelativePath: string;
  processed: IngestedFile;
}
export interface VersionFile {
  snapshotPath: string;
  thumbnailPath: string | null;
  type: string;
  name: string;
  assetId: string;
  libraryId: string;
}
export interface AssetSource {
  id: string;
  assetId: string;
  rootId: string;
  relativePath: string;
  actualRelativePath: string;
  lastHash: string;
  available: boolean;
  createdAt: string;
  updatedAt: string;
}
export class CatalogError extends Error {
  constructor(
    message: string,
    readonly code = 'NOT_FOUND',
    readonly statusCode = 404,
  ) {
    super(message);
    this.name = 'CatalogError';
  }
}
function invalid(message: string): never {
  throw new CatalogError(message, 'INVALID_RELATION', 400);
}
function camel(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );
}
function normalizeRelative(path: string): string {
  const normalized = path.replaceAll('\\', '/').normalize('NFC');
  if (
    !normalized ||
    isAbsolute(normalized) ||
    /^[a-z]:/i.test(normalized) ||
    normalized
      .split('/')
      .some((segment) => !segment || segment === '.' || segment === '..')
  )
    invalid('Expected a safe relative file path');
  return normalized;
}
const now = () => new Date().toISOString();

export class CatalogStore {
  private readonly sqlite: Database.Database;
  readonly scanStore: ScanStore;
  readonly inboxMigrations: InboxMigrationStore;
  constructor(db: AppDatabase) {
    this.sqlite = db.sqlite;
    this.scanStore = new ScanStore(db);
    this.inboxMigrations = new InboxMigrationStore(db, (ids) =>
      this.refreshAssetSearch(ids),
    );
    registerSearchFunctions(this.sqlite);
  }
  private row(
    sql: string,
    ...values: Array<string | number | null>
  ): Row | undefined {
    return this.sqlite.prepare(sql).get(...values) as Row | undefined;
  }
  private rows(sql: string, ...values: Array<string | number | null>): Row[] {
    return this.sqlite.prepare(sql).all(...values) as Row[];
  }
  private run(sql: string, ...values: Array<string | number | null>) {
    return this.sqlite.prepare(sql).run(...values);
  }
  private require(table: string, id: string): Row {
    const row = this.row(`SELECT * FROM ${table} WHERE id = ?`, id);
    if (!row) throw new CatalogError(`${table} record not found`);
    return row;
  }
  private entity<T>(table: string, id: string, schema: Parser<T>): T {
    return schema.parse(camel(this.require(table, id)));
  }
  private inLibrary(table: string, id: string, libraryId: string): Row {
    const record = this.require(table, id);
    if (record.library_id !== libraryId)
      invalid('Records must belong to the same library');
    return record;
  }
  private log(
    libraryId: string,
    assetId: string | null,
    action: string,
    details: Row = {},
  ) {
    const date = now();
    this.run(
      'INSERT INTO activity VALUES (?,?,?,?,?,?,?)',
      randomUUID(),
      libraryId,
      assetId,
      action,
      JSON.stringify(details),
      date,
      date,
    );
  }

  stats(): Record<string, number> {
    const tables = {
      libraries: 'libraries',
      roots: 'library_roots',
      assets: 'assets',
      sources: 'asset_sources',
      versions: 'asset_versions',
      folders: 'folders',
      tags: 'tags',
      tagGroups: 'tag_groups',
      collections: 'collections',
      annotations: 'annotations',
      activities: 'activity',
    };
    return Object.fromEntries(
      Object.entries(tables).map(([name, table]) => [
        name,
        Number(this.row(`SELECT count(*) AS count FROM ${table}`)?.count ?? 0),
      ]),
    );
  }

  diagnosticRoots(): Array<{ rootId: string; libraryId: string }> {
    return this.rows(
      'SELECT id,library_id FROM library_roots WHERE removed_at IS NULL AND managed=0 ORDER BY id',
    ).map((row) => ({
      rootId: C.IdSchema.parse(row.id),
      libraryId: C.IdSchema.parse(row.library_id),
    }));
  }

  previewStateCounts(): C.PreviewStateCounts {
    // Explicit persisted states and retained thumbnails apply to all versions.
    // Infer pending only for the same rich formats as listPendingPreviews;
    // native raster failures without a persisted state are not browser jobs.
    const result: C.PreviewStateCounts = {
      total: 0,
      ready: 0,
      pending: 0,
      failed: 0,
      unsupported: 0,
      notApplicable: 0,
    };
    for (const row of this.rows(`SELECT state,count(*) AS count FROM (
      SELECT CASE
        WHEN json_extract(payload,'$.previewState') IN ('ready','pending','failed','unsupported') THEN json_extract(payload,'$.previewState')
        WHEN thumbnail_path IS NOT NULL THEN 'ready'
        WHEN json_extract(payload,'$.type') NOT IN ('image/png','image/jpeg','image/webp','image/gif','image/svg+xml','image/avif')
          AND (lower(json_extract(payload,'$.name')) GLOB '*.glb'
          OR lower(json_extract(payload,'$.name')) GLOB '*.obj'
          OR lower(json_extract(payload,'$.name')) GLOB '*.psd'
          OR lower(json_extract(payload,'$.name')) GLOB '*.pdf'
          OR lower(json_extract(payload,'$.name')) GLOB '*.mp4'
          OR lower(json_extract(payload,'$.name')) GLOB '*.mov') THEN 'pending'
        ELSE 'notApplicable' END AS state FROM asset_versions
      ) GROUP BY state`)) {
      const state = String(row.state) as Exclude<
        keyof C.PreviewStateCounts,
        'total'
      >;
      const count = Number(row.count);
      result[state] = count;
      result.total += count;
    }
    return C.PreviewStateCountsSchema.parse(result);
  }

  listLibraries(): C.Library[] {
    return this.rows('SELECT * FROM libraries ORDER BY created_at,id').map(
      (row) => C.LibrarySchema.parse(camel(row)),
    );
  }
  getLibrary(id: string): C.Library {
    return this.entity('libraries', id, C.LibrarySchema);
  }
  createLibrary(input: C.CreateLibrary): C.Library {
    const data = C.CreateLibrarySchema.parse(input),
      id = randomUUID(),
      date = now();
    this.run(
      'INSERT INTO libraries VALUES (?,?,?,?)',
      id,
      data.name,
      date,
      date,
    );
    return this.getLibrary(id);
  }
  updateLibrary(id: string, input: C.CreateLibrary): C.Library {
    this.getLibrary(id);
    const data = C.UpdateLibrarySchema.parse(input);
    this.run(
      'UPDATE libraries SET name=?,updated_at=? WHERE id=?',
      data.name,
      now(),
      id,
    );
    return this.getLibrary(id);
  }
  listRoots(libraryId: string): C.LibraryRoot[] {
    this.getLibrary(libraryId);
    return this.rows(
      'SELECT * FROM library_roots WHERE library_id=? AND removed_at IS NULL AND managed=0 ORDER BY created_at,id',
      libraryId,
    ).map((row) => C.LibraryRootSchema.parse(camel(row)));
  }
  getRoot(id: string): C.LibraryRoot {
    const row = this.require('library_roots', id);
    if (row.removed_at || row.managed === 1)
      throw new CatalogError('Root is not registered for local files');
    return C.LibraryRootSchema.parse(camel(row));
  }
  addRoot(
    libraryId: string,
    path: string,
    kind: 'reference' | 'inbox' = 'reference',
  ): C.LibraryRoot {
    this.getLibrary(libraryId);
    C.RegisterRootSchema.parse({ path });
    return this.sqlite.transaction(() => {
      const existing = this.row(
        'SELECT id FROM library_roots WHERE library_id=? AND path=? AND removed_at IS NULL',
        libraryId,
        path,
      );
      if (existing) return this.getRoot(String(existing.id));
      const removed = this.row(
        'SELECT id FROM library_roots WHERE library_id=? AND path=? AND removed_at IS NOT NULL AND managed=0 ORDER BY removed_at DESC,updated_at DESC,id LIMIT 1',
        libraryId,
        path,
      );
      const date = now();
      if (removed) {
        // A scan reactivates observed aliases; registration alone must not
        // restore missing files, trash, or the source's last observed hash.
        this.run(
          'UPDATE library_roots SET removed_at=NULL,updated_at=? WHERE id=?',
          date,
          String(removed.id),
        );
        return this.getRoot(String(removed.id));
      }
      const id = randomUUID();
      this.run(
        'INSERT INTO library_roots(id,library_id,path,kind,removed_at,created_at,updated_at) VALUES (?,?,?,?,NULL,?,?)',
        id,
        libraryId,
        path,
        kind,
        date,
        date,
      );
      return this.getRoot(id);
    })();
  }
  deleteRoot(
    id: string,
    mode: C.RootRemovalMode = 'trash',
  ): C.RemoveRootResult {
    C.RootRemovalModeSchema.parse(mode);
    return this.sqlite.transaction(() => {
      const root = this.getRoot(id);
      const date = now();
      const assets = this.rows(
        'SELECT DISTINCT asset_id FROM asset_sources WHERE root_id=?',
        id,
      );
      this.run(
        'UPDATE library_roots SET removed_at=?,updated_at=? WHERE id=?',
        date,
        date,
        id,
      );
      this.run(
        'UPDATE asset_sources SET available=0,updated_at=? WHERE root_id=?',
        date,
        id,
      );
      const result: C.RemoveRootResult = {
        ok: true,
        rootId: id,
        libraryId: root.libraryId,
        affected: assets.length,
        trashed: 0,
        offline: 0,
        keptAvailable: 0,
      };
      for (const row of assets) {
        const asset = this.refreshSourceLocation(String(row.asset_id));
        if (!asset.missing) result.keptAvailable++;
        else if (!asset.deletedAt) {
          if (mode === 'trash') {
            this.writeAsset({ ...asset, deletedAt: date, updatedAt: date });
            this.log(root.libraryId, asset.id, 'trash', {
              reason: 'root-removed',
              rootId: id,
            });
            result.trashed++;
          } else result.offline++;
        }
      }
      return C.RemoveRootResultSchema.parse(result);
    })();
  }
  getSource(rootId: string, relativePath: string): AssetSource | undefined {
    const row = this.row(
      'SELECT * FROM asset_sources WHERE root_id=? AND relative_path=?',
      rootId,
      normalizeRelative(relativePath),
    );
    return row
      ? ({
          ...camel(row),
          available: row.available === 1,
        } as unknown as AssetSource)
      : undefined;
  }

  listSourcePaths(rootId: string): string[] {
    this.getRoot(rootId);
    return this.rows(
      'SELECT relative_path FROM asset_sources WHERE root_id=? ORDER BY relative_path',
      rootId,
    ).map((row) => String(row.relative_path));
  }

  markSourceMissing(rootId: string, relativePath: string): C.Asset | null {
    const source = this.getSource(rootId, relativePath);
    if (!source?.available) return null;
    return this.sqlite.transaction(() => {
      this.run(
        'UPDATE asset_sources SET available=0,updated_at=? WHERE id=?',
        now(),
        source.id,
      );
      return this.refreshSourceLocation(source.assetId);
    })();
  }
  reconcileSources(rootId: string, presentRelativePaths: string[]): C.Asset[] {
    this.getRoot(rootId);
    const present = new Set(presentRelativePaths.map(normalizeRelative));
    return this.sqlite.transaction(() => {
      const changed = new Set<string>();
      for (const row of this.rows(
        'SELECT relative_path FROM asset_sources WHERE root_id=? AND available=1',
        rootId,
      )) {
        const path = String(row.relative_path);
        if (!present.has(path)) {
          const asset = this.markSourceMissing(rootId, path);
          if (asset) changed.add(asset.id);
        }
      }
      return [...changed].map((id) => this.getAsset(id));
    })();
  }
  private refreshSourceLocation(assetId: string): C.Asset {
    const asset = this.getAsset(assetId);
    const available = this.rows(
      'SELECT s.* FROM asset_sources s JOIN library_roots r ON r.id=s.root_id WHERE s.asset_id=? AND s.available=1 AND r.removed_at IS NULL ORDER BY s.created_at,s.id',
      assetId,
    );
    const primary = available.find(
      (source) =>
        source.root_id === asset.rootId &&
        source.relative_path === asset.relativePath,
    );
    const managedPrimary = this.row(
      'SELECT 1 FROM library_roots WHERE id=? AND managed=1 AND removed_at IS NULL',
      asset.rootId,
    );
    const replacement = primary || managedPrimary ? undefined : available[0];
    this.writeAsset({
      ...asset,
      ...(replacement
        ? {
            rootId: String(replacement.root_id),
            relativePath: String(replacement.relative_path),
            name: basename(String(replacement.relative_path)),
          }
        : {}),
      updatedAt: now(),
    });
    return this.getAsset(assetId);
  }
  getAsset(id: string): C.Asset {
    const row = this.require('assets', id);
    const payload: unknown = JSON.parse(String(row.payload));
    const tags = this.rows(
      'SELECT t.* FROM tags t JOIN asset_tags at ON at.tag_id=t.id WHERE at.asset_id=? ORDER BY t.name,t.id',
      id,
    ).map((row) => C.TagSchema.parse(camel(row)));
    const missing =
      this.row(
        `SELECT ${ASSET_AVAILABLE_SQL} AS available FROM assets a WHERE a.id=?`,
        id,
      )?.available !== 1;
    return C.AssetSchema.parse({
      ...Object(payload),
      ...camel(row),
      tags,
      missing,
    });
  }
  listAssets(libraryId: string, query: C.AssetQuery = {}): C.AssetPage {
    this.getLibrary(libraryId);
    const parsed = C.AssetQuerySchema.parse(query);
    let similarHash: string | undefined;
    if (parsed.similarTo) {
      const reference = this.getAsset(parsed.similarTo);
      if (reference.libraryId !== libraryId)
        invalid('Similar asset belongs to another library');
      if (!/^[a-f\d]{16}$/i.test(reference.phash))
        throw new CatalogError(
          'Similarity unavailable for this format',
          'SIMILARITY_UNAVAILABLE',
          400,
        );
      similarHash = reference.phash;
    }
    const search = assetSearch(libraryId, parsed, similarHash);
    const where =
      search.where +
      (similarHash === undefined
        ? ''
        : " AND length(json_extract(a.payload, '$.phash'))=16 AND json_extract(a.payload, '$.phash') NOT GLOB '*[^0-9a-fA-F]*'");
    const total = Number(
      this.row(
        `SELECT count(*) AS total FROM assets a WHERE ${where}`,
        ...search.params,
      )?.total ?? 0,
    );
    const items = this.rows(
      `SELECT a.id FROM assets a WHERE ${where} ORDER BY ${search.order} LIMIT ? OFFSET ?`,
      ...search.params,
      ...search.orderParams,
      search.limit,
      search.offset,
    ).map((row) => this.getAsset(String(row.id)));
    return C.AssetPageSchema.parse({ items, total });
  }
  private writeAsset(asset: C.Asset): void {
    const payload = { ...asset, tags: undefined };
    this.run(
      'UPDATE assets SET root_id=?,relative_path=?,current_hash=?,folder_id=?,deleted_at=?,payload=?,updated_at=? WHERE id=?',
      asset.rootId,
      asset.relativePath,
      asset.hash,
      asset.folderId,
      asset.deletedAt,
      JSON.stringify(payload),
      asset.updatedAt,
      asset.id,
    );
    this.refreshSearch(asset.id);
  }
  private refreshSearch(id: string): void {
    const asset = this.getAsset(id);
    const aliases = this.rows(
      'SELECT relative_path FROM asset_sources WHERE asset_id=?',
      id,
    ).map((row) => String(row.relative_path));
    const text = [
      asset.name,
      asset.displayName ?? '',
      asset.relativePath,
      ...aliases,
      asset.note,
      asset.prompt,
      asset.negativePrompt,
      asset.model,
      asset.source,
      ...asset.tags.map((tag) => tag.name),
    ]
      .join(' ')
      .normalize('NFC')
      .toLowerCase();
    this.run('UPDATE assets SET search_text=? WHERE id=?', text, id);
    this.run('DELETE FROM asset_fts WHERE asset_id=?', id);
    this.run('INSERT INTO asset_fts(asset_id,text) VALUES (?,?)', id, text);
  }
  /** Refresh replayed fields without minting domain timestamps or activity. */
  refreshAssetSearch(assetIds: readonly string[]): void {
    this.sqlite.transaction(() => {
      for (const id of new Set(assetIds)) this.refreshSearch(id);
    })();
  }
  private setTags(assetId: string, tagIds: string[]): void {
    this.run('DELETE FROM asset_tags WHERE asset_id=?', assetId);
    const date = now();
    for (const tagId of new Set(tagIds))
      this.run(
        'INSERT INTO asset_tags VALUES (?,?,?,?)',
        assetId,
        tagId,
        date,
        date,
      );
  }
  private checkPatch(libraryId: string, patch: C.UpdateAsset): void {
    if (patch.folderId) this.inLibrary('folders', patch.folderId, libraryId);
    for (const id of patch.tagIds ?? []) this.inLibrary('tags', id, libraryId);
  }
  updateAsset(id: string, input: C.UpdateAsset): C.Asset {
    const patch = C.UpdateAssetSchema.parse(input);
    return this.sqlite.transaction(() => {
      const asset = this.getAsset(id);
      this.checkPatch(asset.libraryId, patch);
      if (
        patch.archivedAt &&
        this.row('SELECT 1 FROM final_selections WHERE asset_id=? LIMIT 1', id)
      )
        throw new CatalogError(
          'An asset with an active final selection cannot be archived',
          'FINAL_ASSET_PROTECTED',
          409,
        );
      const { tagIds, finalized, ...fields } = patch;
      if (tagIds) this.setTags(id, tagIds);
      const generation = C.GenerationSchema.partial().parse(fields);
      if (Object.keys(generation).length) {
        const version = this.require('asset_versions', asset.currentVersionId);
        const updatedAt = now();
        const payload = C.AssetVersionSchema.parse({
          ...(JSON.parse(String(version.payload)) as Row),
          ...generation,
          updatedAt,
        });
        this.run(
          'UPDATE asset_versions SET payload=?,updated_at=? WHERE id=?',
          JSON.stringify(payload),
          updatedAt,
          asset.currentVersionId,
        );
        if (payload.generationId)
          this.run(
            'UPDATE recorded_generations SET source=?,model=?,updated_at=? WHERE id=?',
            payload.source,
            payload.model,
            updatedAt,
            payload.generationId,
          );
      }

      this.writeAsset(
        C.AssetSchema.parse({ ...asset, ...fields, updatedAt: now() }),
      );
      if (finalized !== undefined)
        setFinalSelection(
          this.sqlite,
          { libraryId: asset.libraryId, ownerKind: 'manual', ownerId: id },
          finalized ? { assetId: id, versionId: asset.currentVersionId } : null,
        );
      this.log(asset.libraryId, id, 'update', fields);
      return this.getAsset(id);
    })();
  }
  batchAssets(libraryId: string, input: C.BatchAssets): C.Asset[] {
    const data = C.BatchAssetsSchema.parse(input);
    this.getLibrary(libraryId);
    return this.sqlite.transaction(() => {
      const ids = [...new Set(data.assetIds)];
      const assets = ids.map((id) => {
        this.inLibrary('assets', id, libraryId);
        return this.getAsset(id);
      });
      for (const id of [
        ...(data.addTagIds ?? []),
        ...(data.removeTagIds ?? []),
      ])
        this.inLibrary('tags', id, libraryId);
      if (data.patch) this.checkPatch(libraryId, data.patch);
      for (const asset of assets) {
        const base = data.patch?.tagIds ?? asset.tags.map((tag) => tag.id);
        const tags = [...new Set([...base, ...(data.addTagIds ?? [])])].filter(
          (id) => !data.removeTagIds?.includes(id),
        );
        const updated = this.updateAsset(asset.id, {
          ...data.patch,
          tagIds: tags,
          ...(data.action === 'archive'
            ? { archivedAt: now() }
            : data.action === 'unarchive'
              ? { archivedAt: null }
              : {}),
        });
        if (data.action === 'trash' || data.action === 'restore') {
          updated.deletedAt = data.action === 'trash' ? now() : null;
          updated.updatedAt = now();
          this.writeAsset(updated);
          this.log(libraryId, asset.id, data.action);
        }
      }
      return ids.map((id) => this.getAsset(id));
    })();
  }
  listVersions(assetId: string): C.AssetVersion[] {
    this.getAsset(assetId);
    return this.rows(
      'SELECT * FROM asset_versions WHERE asset_id=? ORDER BY ordinal DESC',
      assetId,
    ).map((row) =>
      C.AssetVersionSchema.parse({
        ...(JSON.parse(String(row.payload)) as Row),
        ...camel(row),
      }),
    );
  }
  getVersionFile(id: string): VersionFile {
    const row = this.require('asset_versions', id),
      payload = C.AssetVersionSchema.parse(JSON.parse(String(row.payload))),
      asset = this.getAsset(String(row.asset_id));
    return {
      snapshotPath: String(row.snapshot_path),
      thumbnailPath:
        row.thumbnail_path === null ? null : String(row.thumbnail_path),
      type: payload.type,
      name: payload.name,
      assetId: asset.id,
      libraryId: asset.libraryId,
    };
  }
  listAllVersions(): Array<VersionFile & { id: string }> {
    return this.rows(
      `SELECT v.id, v.asset_id, a.library_id, v.snapshot_path, v.thumbnail_path,
        json_extract(v.payload, '$.type') AS type,
        json_extract(v.payload, '$.name') AS name
       FROM asset_versions v JOIN assets a ON a.id = v.asset_id
       ORDER BY v.created_at, v.id`,
    ).map((row) => ({
      id: String(row.id),
      assetId: String(row.asset_id),
      libraryId: String(row.library_id),
      snapshotPath: String(row.snapshot_path),
      thumbnailPath:
        row.thumbnail_path === null ? null : String(row.thumbnail_path),
      type: String(row.type),
      name: String(row.name),
    }));
  }
  getVersionPreview(versionId: string): C.AssetVersion {
    return C.AssetVersionSchema.parse(
      JSON.parse(String(this.require('asset_versions', versionId).payload)),
    );
  }
  listPendingPreviews(
    libraryId: string,
    nativeVersionIds: readonly string[] = [],
  ): C.PreviewCandidate[] {
    this.getLibrary(libraryId);
    return this.rows(
      `SELECT v.id,v.payload FROM asset_versions v JOIN assets a ON a.id=v.asset_id
      WHERE a.library_id=? AND (json_extract(v.payload,'$.previewState') IS NULL OR json_extract(v.payload,'$.previewState')='pending')
      AND v.id NOT IN (SELECT value FROM json_each(?))
      AND json_extract(v.payload,'$.type') NOT IN ('image/png','image/jpeg','image/webp','image/gif','image/avif','image/svg+xml')
      AND (lower(json_extract(v.payload,'$.name')) GLOB '*.glb' OR lower(json_extract(v.payload,'$.name')) GLOB '*.obj' OR lower(json_extract(v.payload,'$.name')) GLOB '*.psd' OR lower(json_extract(v.payload,'$.name')) GLOB '*.pdf' OR lower(json_extract(v.payload,'$.name')) GLOB '*.mp4' OR lower(json_extract(v.payload,'$.name')) GLOB '*.mov')
      ORDER BY v.created_at,v.id LIMIT 16`,
      libraryId,
      JSON.stringify(nativeVersionIds),
    ).flatMap((row) => {
      const version = C.AssetVersionSchema.parse(
        JSON.parse(String(row.payload)),
      );
      const format = C.richPreviewFormat(version.name, version.type);
      return format
        ? [
            {
              id: version.id,
              assetId: version.assetId,
              sourceHash: version.hash,
              name: version.name,
              size: version.size,
              format,
              revision: version.previewRevision ?? 0,
            },
          ]
        : [];
    });
  }
  checkPreviewRevision(
    versionId: string,
    sourceHash: string,
    revision: number,
  ): C.AssetVersion {
    const version = this.getVersionPreview(versionId);
    if (
      version.hash !== sourceHash ||
      (version.previewRevision ?? 0) !== revision
    )
      throw new CatalogError(
        'The source or preview revision changed.',
        'STALE_PREVIEW',
        409,
      );
    if (!C.richPreviewFormat(version.name, version.type))
      throw new CatalogError(
        'This version does not use browser previews.',
        'INVALID_PREVIEW',
        400,
      );
    return version;
  }
  updateVersionPreview(
    versionId: string,
    thumbnailPath: string | null,
    patch: {
      state?: C.AssetVersion['previewState'];
      error?: string | null;
    } = {},
  ): void {
    this.sqlite.transaction(() => {
      const version = this.getVersionPreview(versionId),
        date = now();
      const previewState =
        patch.state ??
        (thumbnailPath
          ? 'ready'
          : C.richPreviewFormat(version.name, version.type)
            ? 'pending'
            : undefined);
      const fields = {
        previewState,
        previewRevision: (version.previewRevision ?? 0) + 1,
        previewError: patch.error ?? null,
      };
      const payload = {
        ...version,
        ...fields,
        updatedAt: date,
      };
      this.run(
        'UPDATE asset_versions SET thumbnail_path=?,updated_at=?,payload=? WHERE id=?',
        thumbnailPath,
        date,
        JSON.stringify(payload),
        versionId,
      );
      const asset = this.getAsset(version.assetId);
      if (asset.currentVersionId === versionId)
        this.writeAsset(
          C.AssetSchema.parse({
            ...asset,
            ...fields,
            updatedAt: date,
          }),
        );
    })();
  }
  private fileMetadata(processed: IngestedFile) {
    return {
      previewState: processed.thumbnailPath ? ('ready' as const) : undefined,
      previewRevision: 0,
      previewError: null,
      hash: processed.hash,
      size: processed.size,
      type: processed.type,
      width: processed.width,
      height: processed.height,
      colors: processed.colors,
      phash: processed.phash,
      exif: processed.exif,
      ...C.GenerationSchema.parse(processed.generation),
    };
  }
  private appendVersion(
    asset: C.Asset,
    processed: IngestedFile,
    name: string,
  ): C.Asset {
    const date = now(),
      id = randomUUID();
    const ordinal = Number(
      this.row(
        'SELECT coalesce(max(ordinal),0)+1 AS next FROM asset_versions WHERE asset_id=?',
        asset.id,
      )?.next,
    );
    const metadata = {
      ...this.fileMetadata(processed),
      generationId: randomUUID(),
    };
    this.run(
      'INSERT INTO recorded_generations VALUES (?,?,?,?,?,?,?,?)',
      metadata.generationId,
      asset.libraryId,
      metadata.hash,
      metadata.source,
      metadata.model,
      'recorded',
      date,
      date,
    );
    const version = C.AssetVersionSchema.parse({
      id,
      assetId: asset.id,
      ordinal,
      name,
      ...metadata,
      createdAt: date,
      updatedAt: date,
    });
    this.run(
      'INSERT INTO asset_versions VALUES (?,?,?,?,?,?,?,?)',
      id,
      asset.id,
      ordinal,
      JSON.stringify(version),
      processed.snapshotPath,
      processed.thumbnailPath,
      date,
      date,
    );
    const updated = C.AssetSchema.parse({
      ...asset,
      ...metadata,
      name,
      currentVersionId: id,
      finalized: false,
      updatedAt: date,
    });
    this.writeAsset(updated);
    return this.getAsset(asset.id);
  }
  private insertAsset(
    libraryId: string,
    rootId: string,
    relativePath: string,
    processed: IngestedFile,
    inherited?: C.Asset,
  ): C.Asset {
    const id = randomUUID(),
      date = now();
    const asset = C.AssetSchema.parse({
      ...inherited,
      id,
      libraryId,
      rootId,
      relativePath,
      name: basename(relativePath),
      ...this.fileMetadata(processed),
      currentVersionId: randomUUID(),
      rating: inherited?.rating ?? 0,
      note: inherited?.note ?? '',
      folderId: inherited?.folderId ?? null,
      deletedAt: null,
      finalized: false,
      tags: [],
      createdAt: date,
      updatedAt: date,
    });
    this.run(
      'INSERT INTO assets (id,library_id,root_id,relative_path,current_hash,folder_id,deleted_at,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,NULL,?,?,?)',
      id,
      libraryId,
      rootId,
      relativePath,
      processed.hash,
      asset.folderId,
      JSON.stringify(asset),
      date,
      date,
    );
    if (inherited) {
      const mapping = new Map<string, string>();
      for (const original of this.rows(
        'SELECT * FROM asset_versions WHERE asset_id=? ORDER BY ordinal',
        inherited.id,
      )) {
        const versionId = randomUUID();
        mapping.set(String(original.id), versionId);
        const payload = {
          ...(JSON.parse(String(original.payload)) as Row),
          id: versionId,
          assetId: id,
        };
        this.run(
          'INSERT INTO asset_versions VALUES (?,?,?,?,?,?,?,?)',
          versionId,
          id,
          Number(original.ordinal),
          JSON.stringify(payload),
          String(original.snapshot_path),
          original.thumbnail_path === null
            ? null
            : String(original.thumbnail_path),
          String(original.created_at),
          String(original.updated_at),
        );
      }
      this.setTags(
        id,
        inherited.tags.map((tag) => tag.id),
      );
      for (const annotation of this.listAnnotations(inherited.id))
        this.run(
          'INSERT INTO annotations VALUES (?,?,?,?,?,?,?,?)',
          randomUUID(),
          id,
          mapping.get(annotation.versionId)!,
          annotation.x,
          annotation.y,
          annotation.text,
          annotation.createdAt,
          annotation.updatedAt,
        );
    }
    return this.appendVersion(asset, processed, asset.name);
  }
  ingest(input: IngestInput): { asset: C.Asset; changed: boolean } {
    const root = this.getRoot(input.rootId);
    if (root.libraryId !== input.libraryId)
      invalid('Root belongs to another library');
    const relativePath = normalizeRelative(input.relativePath);
    normalizeRelative(input.actualRelativePath);
    return this.sqlite.transaction(() => {
      const source = this.getSource(input.rootId, relativePath),
        date = now();
      let asset: C.Asset;
      if (source) {
        asset = this.getAsset(source.assetId);
        if (
          source.lastHash === input.processed.hash ||
          asset.hash === input.processed.hash
        ) {
          this.run(
            'UPDATE asset_sources SET available=1,last_hash=?,actual_relative_path=?,updated_at=? WHERE id=?',
            input.processed.hash,
            input.actualRelativePath,
            date,
            source.id,
          );
          if (!source.available) asset = this.refreshSourceLocation(asset.id);
          return { asset: this.getAsset(asset.id), changed: !source.available };
        }
        const aliases = Number(
          this.row(
            'SELECT count(*) AS count FROM asset_sources s JOIN library_roots r ON r.id=s.root_id WHERE s.asset_id=? AND s.id<>? AND s.available=1 AND r.removed_at IS NULL',
            asset.id,
            source.id,
          )?.count,
        );
        if (aliases > 0) {
          const previous = asset;
          asset = this.insertAsset(
            input.libraryId,
            input.rootId,
            relativePath,
            input.processed,
            asset,
          );
          this.run(
            'UPDATE asset_sources SET available=1,asset_id=?,last_hash=?,actual_relative_path=?,updated_at=? WHERE id=?',
            asset.id,
            input.processed.hash,
            input.actualRelativePath,
            date,
            source.id,
          );
          this.refreshSourceLocation(previous.id);
        } else {
          asset = this.appendVersion(
            { ...asset, rootId: input.rootId, relativePath },
            input.processed,
            basename(relativePath),
          );
          this.run(
            'UPDATE asset_sources SET available=1,last_hash=?,actual_relative_path=?,updated_at=? WHERE id=?',
            input.processed.hash,
            input.actualRelativePath,
            date,
            source.id,
          );
        }
      } else {
        const duplicate = this.row(
          'SELECT id FROM assets WHERE library_id=? AND current_hash=? AND deleted_at IS NULL ORDER BY created_at,id LIMIT 1',
          input.libraryId,
          input.processed.hash,
        );
        asset = duplicate
          ? this.getAsset(String(duplicate.id))
          : this.insertAsset(
              input.libraryId,
              input.rootId,
              relativePath,
              input.processed,
            );
        this.run(
          'INSERT INTO asset_sources (id,asset_id,root_id,relative_path,actual_relative_path,last_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
          randomUUID(),
          asset.id,
          input.rootId,
          relativePath,
          input.actualRelativePath,
          input.processed.hash,
          date,
          date,
        );
      }
      this.refreshSourceLocation(asset.id);
      this.log(input.libraryId, asset.id, 'ingest', { relativePath });
      return { asset: this.getAsset(asset.id), changed: true };
    })();
  }
  replaceAsset(
    assetId: string,
    processed: IngestedFile,
    name: string,
  ): C.Asset {
    const filename = C.UploadQuerySchema.parse({ name }).name;
    return this.sqlite.transaction(() => {
      const asset = this.getAsset(assetId);
      if (asset.hash === processed.hash) return asset;
      const result = this.appendVersion(asset, processed, filename);
      this.log(asset.libraryId, asset.id, 'replace');
      return result;
    })();
  }

  listFolders(libraryId: string): C.Folder[] {
    this.getLibrary(libraryId);
    return this.rows(
      'SELECT * FROM folders WHERE library_id=? ORDER BY name,id',
      libraryId,
    ).map((row) => C.FolderSchema.parse(camel(row)));
  }
  createFolder(libraryId: string, input: C.CreateFolder): C.Folder {
    this.getLibrary(libraryId);
    const data = C.CreateFolderSchema.parse(input);
    if (data.parentId) this.inLibrary('folders', data.parentId, libraryId);
    const id = randomUUID(),
      date = now();
    this.run(
      'INSERT INTO folders VALUES (?,?,?,?,?,?)',
      id,
      libraryId,
      data.name,
      data.parentId,
      date,
      date,
    );
    return this.entity('folders', id, C.FolderSchema);
  }
  updateFolder(id: string, input: C.UpdateFolder): C.Folder {
    const current = this.entity('folders', id, C.FolderSchema),
      data = C.UpdateFolderSchema.parse(input),
      parent = data.parentId === undefined ? current.parentId : data.parentId;
    if (parent) {
      this.inLibrary('folders', parent, current.libraryId);
      let cursor: string | null = parent;
      while (cursor) {
        if (cursor === id) invalid('Folder hierarchy cannot contain cycles');
        cursor = this.entity('folders', cursor, C.FolderSchema).parentId;
      }
    }
    this.run(
      'UPDATE folders SET name=?,parent_id=?,updated_at=? WHERE id=?',
      data.name ?? current.name,
      parent,
      now(),
      id,
    );
    return this.entity('folders', id, C.FolderSchema);
  }
  deleteFolder(id: string): void {
    const folder = this.entity('folders', id, C.FolderSchema);
    this.sqlite.transaction(() => {
      for (const row of this.rows(
        'SELECT id FROM assets WHERE folder_id=?',
        id,
      )) {
        const asset = this.getAsset(String(row.id));
        this.writeAsset({
          ...asset,
          folderId: folder.parentId,
          updatedAt: now(),
        });
      }
      this.run(
        'UPDATE folders SET parent_id=?,updated_at=? WHERE parent_id=?',
        folder.parentId,
        now(),
        id,
      );
      this.run('DELETE FROM folders WHERE id=?', id);
    })();
  }
  listTagGroups(libraryId: string): C.TagGroup[] {
    this.getLibrary(libraryId);
    return this.rows(
      'SELECT * FROM tag_groups WHERE library_id=? ORDER BY name,id',
      libraryId,
    ).map((row) => C.TagGroupSchema.parse(camel(row)));
  }
  createTagGroup(libraryId: string, input: C.CreateTagGroup): C.TagGroup {
    this.getLibrary(libraryId);
    const data = C.CreateTagGroupSchema.parse(input),
      id = randomUUID(),
      date = now();
    this.run(
      'INSERT INTO tag_groups VALUES (?,?,?,?,?)',
      id,
      libraryId,
      data.name,
      date,
      date,
    );
    return this.entity('tag_groups', id, C.TagGroupSchema);
  }
  updateTagGroup(id: string, input: C.CreateTagGroup): C.TagGroup {
    this.require('tag_groups', id);
    const data = C.UpdateTagGroupSchema.parse(input);
    this.run(
      'UPDATE tag_groups SET name=?,updated_at=? WHERE id=?',
      data.name,
      now(),
      id,
    );
    return this.entity('tag_groups', id, C.TagGroupSchema);
  }
  deleteTagGroup(id: string): void {
    this.require('tag_groups', id);
    this.sqlite.transaction(() => {
      this.run(
        'UPDATE tags SET group_id=NULL,updated_at=? WHERE group_id=?',
        now(),
        id,
      );
      this.run('DELETE FROM tag_groups WHERE id=?', id);
    })();
  }
  listTags(libraryId: string): C.Tag[] {
    this.getLibrary(libraryId);
    return this.rows(
      'SELECT * FROM tags WHERE library_id=? ORDER BY name,id',
      libraryId,
    ).map((row) => C.TagSchema.parse(camel(row)));
  }
  createTag(libraryId: string, input: C.CreateTag): C.Tag {
    this.getLibrary(libraryId);
    const data = C.CreateTagSchema.parse(input);
    if (data.groupId) this.inLibrary('tag_groups', data.groupId, libraryId);
    const id = randomUUID(),
      date = now();
    this.run(
      'INSERT INTO tags VALUES (?,?,?,?,?,?,?)',
      id,
      libraryId,
      data.name,
      data.color,
      data.groupId,
      date,
      date,
    );
    return this.entity('tags', id, C.TagSchema);
  }
  updateTag(id: string, input: C.UpdateTag): C.Tag {
    const current = this.entity('tags', id, C.TagSchema),
      data = C.UpdateTagSchema.parse(input),
      groupId = data.groupId === undefined ? current.groupId : data.groupId;
    if (groupId) this.inLibrary('tag_groups', groupId, current.libraryId);
    return this.sqlite.transaction(() => {
      this.run(
        'UPDATE tags SET name=?,color=?,group_id=?,updated_at=? WHERE id=?',
        data.name ?? current.name,
        data.color ?? current.color,
        groupId,
        now(),
        id,
      );
      for (const row of this.rows(
        'SELECT asset_id FROM asset_tags WHERE tag_id=?',
        id,
      ))
        this.refreshSearch(String(row.asset_id));
      return this.entity('tags', id, C.TagSchema);
    })();
  }
  deleteTag(id: string): void {
    this.require('tags', id);
    this.sqlite.transaction(() => {
      const assets = this.rows(
        'SELECT asset_id FROM asset_tags WHERE tag_id=?',
        id,
      );
      this.run('DELETE FROM tags WHERE id=?', id);
      for (const row of assets) this.refreshSearch(String(row.asset_id));
    })();
  }
  private collection(row: Row): C.Collection {
    return C.CollectionSchema.parse({
      ...camel(row),
      rules: JSON.parse(String(row.rules)),
    });
  }
  listCollections(libraryId: string): C.Collection[] {
    this.getLibrary(libraryId);
    return this.rows(
      'SELECT * FROM collections WHERE library_id=? ORDER BY name,id',
      libraryId,
    ).map((row) => this.collection(row));
  }
  createCollection(libraryId: string, input: C.CreateCollection): C.Collection {
    this.getLibrary(libraryId);
    const data = C.CreateCollectionSchema.parse(input);
    this.checkQueryRelations(libraryId, data.rules);
    const id = randomUUID(),
      date = now();
    this.run(
      'INSERT INTO collections VALUES (?,?,?,?,?,?)',
      id,
      libraryId,
      data.name,
      JSON.stringify(data.rules),
      date,
      date,
    );
    return this.collection(this.require('collections', id));
  }
  updateCollection(id: string, input: C.UpdateCollection): C.Collection {
    const current = this.collection(this.require('collections', id)),
      data = C.UpdateCollectionSchema.parse(input);
    if (data.rules) this.checkQueryRelations(current.libraryId, data.rules);
    this.run(
      'UPDATE collections SET name=?,rules=?,updated_at=? WHERE id=?',
      data.name ?? current.name,
      JSON.stringify(data.rules ?? current.rules),
      now(),
      id,
    );
    return this.collection(this.require('collections', id));
  }
  deleteCollection(id: string): void {
    this.require('collections', id);
    this.run('DELETE FROM collections WHERE id=?', id);
  }
  private checkQueryRelations(libraryId: string, query: C.AssetQuery): void {
    const q = C.AssetQuerySchema.parse(query);
    if (q.folderId) this.inLibrary('folders', q.folderId, libraryId);
    if (q.tagId) this.inLibrary('tags', q.tagId, libraryId);
    if (q.similarTo) this.inLibrary('assets', q.similarTo, libraryId);
  }
  listAnnotations(assetId: string, versionId?: string): C.Annotation[] {
    this.getAsset(assetId);
    if (
      versionId &&
      this.require('asset_versions', versionId).asset_id !== assetId
    )
      invalid('Version belongs to another asset');
    return this.rows(
      `SELECT * FROM annotations WHERE asset_id=?${versionId ? ' AND version_id=?' : ''} ORDER BY created_at,id`,
      assetId,
      ...(versionId ? [versionId] : []),
    ).map((row) => C.AnnotationSchema.parse(camel(row)));
  }
  createAnnotation(assetId: string, input: C.CreateAnnotation): C.Annotation {
    this.getAsset(assetId);
    const data = C.CreateAnnotationSchema.parse(input);
    if (this.require('asset_versions', data.versionId).asset_id !== assetId)
      invalid('Version belongs to another asset');
    const id = randomUUID(),
      date = now();
    this.run(
      'INSERT INTO annotations VALUES (?,?,?,?,?,?,?,?)',
      id,
      assetId,
      data.versionId,
      data.x,
      data.y,
      data.text,
      date,
      date,
    );
    return this.entity('annotations', id, C.AnnotationSchema);
  }
  updateAnnotation(id: string, input: C.UpdateAnnotation): C.Annotation {
    const patch = C.UpdateAnnotationSchema.parse(input);
    const current = this.entity('annotations', id, C.AnnotationSchema);
    this.run(
      'UPDATE annotations SET text=?,x=?,y=?,updated_at=? WHERE id=?',
      patch.text ?? current.text,
      patch.x ?? current.x,
      patch.y ?? current.y,
      now(),
      id,
    );
    return this.entity('annotations', id, C.AnnotationSchema);
  }
  deleteAnnotation(id: string): void {
    this.require('annotations', id);
    this.run('DELETE FROM annotations WHERE id=?', id);
  }
  getSettings(): C.Settings {
    const row = this.row("SELECT value FROM settings WHERE id='user'");
    return C.SettingsSchema.parse(row ? JSON.parse(String(row.value)) : {});
  }
  updateSettings(input: C.UpdateSettings): C.Settings {
    const patch = C.UpdateSettingsSchema.parse(input);
    if (patch.activeLibraryId) this.getLibrary(patch.activeLibraryId);
    const settings = C.SettingsSchema.parse({
        ...this.getSettings(),
        ...patch,
      }),
      date = now();
    this.run(
      "INSERT INTO settings VALUES ('user',?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
      JSON.stringify(settings),
      date,
      date,
    );
    return settings;
  }
}
