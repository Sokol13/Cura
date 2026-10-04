import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AppDatabase } from '../database.js';

export interface FinalOwner {
  libraryId: string;
  ownerKind: 'manual' | 'slot';
  ownerId: string;
}
export interface FinalPin {
  assetId: string;
  versionId: string;
}
type ProcessDatabase = AppDatabase | Database.Database;
const sqliteOf = (database: ProcessDatabase) =>
  'sqlite' in database ? database.sqlite : database;
const invalid = (message: string): never => {
  throw Object.assign(new Error(message), {
    code: 'INVALID_FINAL_SELECTION',
    statusCode: 400,
  });
};

/** Recompute only the current-version projection; historical owners remain pinned. */
export function syncAssetFinalized(
  database: ProcessDatabase,
  assetId: string,
): void {
  const sqlite = sqliteOf(database);
  const date = new Date().toISOString();
  sqlite
    .prepare(
      `UPDATE assets SET payload=json_set(payload,'$.finalized',json(CASE WHEN EXISTS (SELECT 1 FROM final_selections f WHERE f.asset_id=assets.id AND f.version_id=json_extract(assets.payload,'$.currentVersionId')) THEN 'true' ELSE 'false' END),'$.updatedAt',?),updated_at=? WHERE id=?`,
    )
    .run(date, date, assetId);
}

/** Nested SQLite transactions keep slot history and its final selection atomic. */
export function setFinalSelection(
  database: ProcessDatabase,
  owner: FinalOwner,
  pin: FinalPin | null,
): void {
  const sqlite = sqliteOf(database);
  sqlite.transaction(() => {
    if (
      !sqlite
        .prepare('SELECT id FROM libraries WHERE id=?')
        .get(owner.libraryId)
    )
      invalid('Final selection library does not exist');
    if (!['manual', 'slot'].includes(owner.ownerKind) || !owner.ownerId)
      invalid('Invalid final selection owner');
    if (owner.ownerKind === 'manual') {
      const asset = sqlite
        .prepare('SELECT library_id FROM assets WHERE id=?')
        .get(owner.ownerId) as { library_id: string } | undefined;
      if (
        asset?.library_id !== owner.libraryId ||
        (pin && pin.assetId !== owner.ownerId)
      )
        invalid(
          'A manual final selection belongs to its own asset and library',
        );
    }
    if (pin) {
      const version = sqlite
        .prepare(
          'SELECT v.asset_id,a.library_id FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=?',
        )
        .get(pin.versionId) as
        | { asset_id: string; library_id: string }
        | undefined;
      if (!version || version.asset_id !== pin.assetId)
        return invalid('Final selection version does not belong to this asset');
      if (version.library_id !== owner.libraryId)
        invalid('Final selection asset belongs to another library');
      const restoredAt = new Date().toISOString();
      sqlite
        .prepare(
          "UPDATE assets SET payload=json_set(payload,'$.archivedAt',NULL,'$.updatedAt',?),updated_at=? WHERE id=? AND json_extract(payload,'$.archivedAt') IS NOT NULL",
        )
        .run(restoredAt, restoredAt, pin.assetId);
    }
    const previous = sqlite
      .prepare(
        'SELECT id,asset_id,version_id FROM final_selections WHERE library_id=? AND owner_kind=? AND owner_id=?',
      )
      .get(owner.libraryId, owner.ownerKind, owner.ownerId) as
      | { id: string; asset_id: string; version_id: string }
      | undefined;
    if (
      pin &&
      previous?.asset_id === pin.assetId &&
      previous.version_id === pin.versionId
    )
      return;
    if (!pin && !previous) return;
    const date = new Date().toISOString();
    if (!pin)
      sqlite
        .prepare('DELETE FROM final_selections WHERE id=?')
        .run(previous!.id);
    else
      sqlite
        .prepare(
          'INSERT INTO final_selections VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(library_id,owner_kind,owner_id) DO UPDATE SET asset_id=excluded.asset_id,version_id=excluded.version_id,updated_at=excluded.updated_at',
        )
        .run(
          randomUUID(),
          owner.libraryId,
          owner.ownerKind,
          owner.ownerId,
          pin.assetId,
          pin.versionId,
          date,
          date,
        );
    for (const assetId of new Set([previous?.asset_id, pin?.assetId]))
      if (assetId) syncAssetFinalized(sqlite, assetId);
  })();
}
