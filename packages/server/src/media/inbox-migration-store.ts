import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AppDatabase } from '../database.js';
import { normalizeRelativePath } from './path-utils.js';

export interface InboxFileIdentity {
  hash: string;
  dev: string;
  ino: string;
  size: string;
  mtimeNs: string;
  ctimeNs: string;
}

export interface InboxSource {
  id: string;
  assetId: string;
  libraryId: string;
  rootId: string;
  relativePath: string;
  actualRelativePath: string;
  lastHash: string;
  available: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InboxMigration {
  id: string;
  sourceId: string;
  assetId: string;
  libraryId: string;
  rootId: string;
  oldRelativePath: string;
  oldActualRelativePath: string;
  newRelativePath: string;
  lastHash: string;
  sourceAvailable: boolean;
  sourceCreatedAt: string;
  sourceUpdatedAt: string;
  observed: InboxFileIdentity;
  target: InboxFileIdentity | null;
  state: 'planned' | 'reserved' | 'published' | 'relocated' | 'complete';
  createdAt: string;
  updatedAt: string;
}

type SourceRow = Omit<InboxSource, 'available'> & { available: number };
type MigrationRow = Omit<
  InboxMigration,
  'observed' | 'target' | 'sourceAvailable'
> & {
  observed: string;
  target: string | null;
  sourceAvailable: number;
};
const SOURCE_SQL = `SELECT s.id,s.asset_id AS assetId,r.library_id AS libraryId,
  s.root_id AS rootId,s.relative_path AS relativePath,
  s.actual_relative_path AS actualRelativePath,s.last_hash AS lastHash,
  s.available,s.created_at AS createdAt,s.updated_at AS updatedAt
  FROM asset_sources s JOIN library_roots r ON r.id=s.root_id
  JOIN assets a ON a.id=s.asset_id AND a.library_id=r.library_id
  WHERE r.kind='inbox' AND r.managed=0 AND r.removed_at IS NULL`;
const MIGRATION_SQL = `SELECT id,source_id AS sourceId,asset_id AS assetId,
  library_id AS libraryId,root_id AS rootId,old_relative_path AS oldRelativePath,
  old_actual_relative_path AS oldActualRelativePath,new_relative_path AS newRelativePath,
  last_hash AS lastHash,source_available AS sourceAvailable,
  source_created_at AS sourceCreatedAt,source_updated_at AS sourceUpdatedAt,
  observed,target,state,created_at AS createdAt,updated_at AS updatedAt FROM inbox_migrations`;
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function conflict(message: string): never {
  throw Object.assign(new Error(message), { code: 'INBOX_MIGRATION_CONFLICT' });
}

function identity(value: InboxFileIdentity): InboxFileIdentity {
  if (
    !/^[\da-f]{64}$/.test(value.hash) ||
    !['dev', 'ino', 'size'].every((key) =>
      /^\d{1,30}$/.test(value[key as keyof InboxFileIdentity]),
    ) ||
    !['mtimeNs', 'ctimeNs'].every((key) =>
      /^-?\d{1,30}$/.test(value[key as keyof InboxFileIdentity]),
    )
  )
    conflict('Invalid Inbox file identity');
  return {
    hash: value.hash,
    dev: value.dev,
    ino: value.ino,
    size: value.size,
    mtimeNs: value.mtimeNs,
    ctimeNs: value.ctimeNs,
  };
}

function legacy(source: InboxSource): boolean {
  try {
    const parts = source.relativePath.split('/');
    return (
      parts.length === 2 &&
      uuid.test(parts[0]!) &&
      normalizeRelativePath(source.actualRelativePath) === source.relativePath
    );
  } catch {
    return false;
  }
}

function destination(path: string): string {
  const normalized = normalizeRelativePath(path);
  const parts = normalized.split('/');
  if (parts.length !== 2 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[0]!)) {
    conflict('Expected an Inbox date directory and filename');
  }
  const date = new Date(`${parts[0]}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== parts[0]
  ) {
    conflict('Invalid Inbox date directory');
  }
  return normalized;
}

function migration(row: MigrationRow): InboxMigration {
  return {
    ...row,
    sourceAvailable: row.sourceAvailable === 1,
    observed: identity(JSON.parse(row.observed) as InboxFileIdentity),
    target:
      row.target === null
        ? null
        : identity(JSON.parse(row.target) as InboxFileIdentity),
  };
}

/** Local filesystem recovery state. Never export or sync this journal. */
export class InboxMigrationStore {
  private readonly sqlite: Database.Database;

  constructor(
    db: AppDatabase,
    private readonly refreshSearch?: (assetIds: readonly string[]) => void,
  ) {
    this.sqlite = db.sqlite;
  }

  private source(id: string): InboxSource {
    const row = this.sqlite.prepare(`${SOURCE_SQL} AND s.id=?`).get(id) as
      | SourceRow
      | undefined;
    if (!row) conflict('Source is not in an active local Inbox');
    return { ...row, available: row.available === 1 };
  }

  sources(rootId: string): InboxSource[] {
    const rows = this.sqlite
      .prepare(
        `${SOURCE_SQL} AND s.root_id=?
      AND NOT EXISTS(SELECT 1 FROM inbox_migrations m WHERE m.source_id=s.id AND m.state='complete')
      ORDER BY s.created_at,s.id`,
      )
      .all(rootId) as SourceRow[];
    return rows
      .map((row) => ({ ...row, available: row.available === 1 }))
      .filter(legacy);
  }

  get(id: string): InboxMigration {
    const row = this.sqlite.prepare(`${MIGRATION_SQL} WHERE id=?`).get(id) as
      | MigrationRow
      | undefined;
    if (!row) conflict('Inbox migration not found');
    return migration(row);
  }

  pending(rootId: string): InboxMigration[] {
    const rows = this.sqlite
      .prepare(
        `${MIGRATION_SQL} WHERE root_id=? AND state<>'complete'
      AND EXISTS(SELECT 1 FROM library_roots r WHERE r.id=inbox_migrations.root_id
        AND r.library_id=inbox_migrations.library_id AND r.kind='inbox' AND r.managed=0 AND r.removed_at IS NULL)
      ORDER BY created_at,id`,
      )
      .all(rootId) as MigrationRow[];
    return rows.map(migration);
  }

  plan(
    sourceId: string,
    newRelativePath: string,
    observed: InboxFileIdentity,
  ): InboxMigration {
    return this.sqlite.transaction(() => {
      const source = this.source(sourceId);
      const existing = this.sqlite
        .prepare('SELECT id FROM inbox_migrations WHERE source_id=?')
        .get(sourceId) as { id: string } | undefined;
      if (existing) return this.get(existing.id);
      if (!legacy(source))
        conflict('Source does not use the legacy Inbox layout');
      const id = randomUUID();
      const date = new Date().toISOString();
      this.sqlite
        .prepare(
          `INSERT INTO inbox_migrations
        (id,source_id,asset_id,library_id,root_id,old_relative_path,old_actual_relative_path,
        new_relative_path,last_hash,source_available,source_created_at,source_updated_at,
        observed,target,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,'planned',?,?)`,
        )
        .run(
          id,
          source.id,
          source.assetId,
          source.libraryId,
          source.rootId,
          source.relativePath,
          source.actualRelativePath,
          destination(newRelativePath),
          source.lastHash,
          Number(source.available),
          source.createdAt,
          source.updatedAt,
          JSON.stringify(identity(observed)),
          date,
          date,
        );
      return this.get(id);
    })();
  }

  private assertSource(
    record: InboxMigration,
    relocated = false,
    strict = true,
  ): InboxSource {
    const source = this.source(record.sourceId);
    if (
      source.assetId !== record.assetId ||
      source.libraryId !== record.libraryId ||
      source.rootId !== record.rootId ||
      source.relativePath !==
        (relocated ? record.newRelativePath : record.oldRelativePath) ||
      (relocated
        ? normalizeRelativePath(source.actualRelativePath)
        : source.actualRelativePath) !==
        (relocated ? record.newRelativePath : record.oldActualRelativePath) ||
      (strict && source.lastHash !== record.lastHash)
    ) {
      conflict('Inbox source changed during migration');
    }
    return source;
  }

  update(
    id: string,
    patch: { state?: InboxMigration['state']; target?: InboxFileIdentity },
  ): InboxMigration {
    return this.sqlite.transaction(() => {
      const current = this.get(id);
      this.assertSource(current);
      const state = patch.state ?? current.state;
      const target = patch.target ? identity(patch.target) : current.target;
      const transitions: Record<
        InboxMigration['state'],
        InboxMigration['state'][]
      > = {
        planned: ['planned', 'reserved', 'published'],
        reserved: ['reserved', 'published'],
        published: ['published'],
        relocated: [],
        complete: [],
      };
      if (
        !transitions[current.state].includes(state) ||
        (state !== 'planned' && !target) ||
        (current.target &&
          target &&
          (current.target.dev !== target.dev ||
            current.target.ino !== target.ino)) ||
        (state === 'published' &&
          (target?.hash !== current.observed.hash ||
            target?.size !== current.observed.size))
      ) {
        conflict('Invalid Inbox migration transition');
      }
      this.sqlite
        .prepare(
          'UPDATE inbox_migrations SET state=?,target=?,updated_at=? WHERE id=?',
        )
        .run(
          state,
          target ? JSON.stringify(target) : null,
          new Date().toISOString(),
          id,
        );
      return this.get(id);
    })();
  }

  retarget(
    id: string,
    newRelativePath: string,
    observed?: InboxFileIdentity,
  ): InboxMigration {
    return this.sqlite.transaction(() => {
      const current = this.get(id);
      if (current.state !== 'planned' || current.target)
        conflict('Inbox target already reserved');
      this.assertSource(current, false, !observed);
      this.sqlite
        .prepare(
          'UPDATE inbox_migrations SET new_relative_path=?,updated_at=? WHERE id=?',
        )
        .run(destination(newRelativePath), new Date().toISOString(), id);
      return observed ? this.reobserve(id, observed) : this.get(id);
    })();
  }

  reobserve(id: string, observed: InboxFileIdentity): InboxMigration {
    return this.sqlite.transaction(() => {
      const current = this.get(id);
      if (!['planned', 'reserved', 'published'].includes(current.state))
        conflict('Inbox source already relocated');
      const source = this.assertSource(current, false, false);
      this.sqlite
        .prepare(
          `UPDATE inbox_migrations SET observed=?,last_hash=?,source_available=?,
        source_created_at=?,source_updated_at=?,state=?,updated_at=? WHERE id=?`,
        )
        .run(
          JSON.stringify(identity(observed)),
          source.lastHash,
          Number(source.available),
          source.createdAt,
          source.updatedAt,
          current.target ? 'reserved' : 'planned',
          new Date().toISOString(),
          id,
        );
      return this.get(id);
    })();
  }

  private moveLocators(record: InboxMigration, backwards: boolean): void {
    const from = backwards ? record.newRelativePath : record.oldRelativePath;
    const to = backwards ? record.oldRelativePath : record.newRelativePath;
    this.assertSource(record, backwards);
    this.sqlite
      .prepare(
        'UPDATE asset_sources SET relative_path=?,actual_relative_path=? WHERE id=?',
      )
      .run(
        to,
        backwards ? record.oldActualRelativePath : record.newRelativePath,
        record.sourceId,
      );
    // Updating the payload directly preserves name, currentVersion, timestamps,
    // annotations and immutable version rows, including manual V2. Only derived
    // search data is refreshed after the two locator updates.
    this.sqlite
      .prepare(
        `UPDATE assets SET relative_path=?,payload=json_set(payload,'$.relativePath',?)
      WHERE id=? AND library_id=? AND root_id=? AND relative_path=?`,
      )
      .run(to, to, record.assetId, record.libraryId, record.rootId, from);
    this.refreshSearch?.([record.assetId]);
  }

  relocate(id: string): InboxMigration {
    return this.sqlite.transaction(() => {
      const current = this.get(id);
      if (current.state === 'relocated' || current.state === 'complete')
        return current;
      if (current.state !== 'published')
        conflict('Inbox target has not been published');
      this.moveLocators(current, false);
      this.sqlite
        .prepare(
          "UPDATE inbox_migrations SET state='relocated',updated_at=? WHERE id=?",
        )
        .run(new Date().toISOString(), id);
      return this.get(id);
    })();
  }

  rollback(id: string): InboxMigration {
    return this.sqlite.transaction(() => {
      const current = this.get(id);
      if (current.state !== 'relocated')
        conflict('Inbox source has not been relocated');
      this.moveLocators(current, true);
      this.sqlite
        .prepare(
          "UPDATE inbox_migrations SET state='reserved',updated_at=? WHERE id=?",
        )
        .run(new Date().toISOString(), id);
      return this.get(id);
    })();
  }

  complete(id: string): InboxMigration {
    return this.sqlite.transaction(() => {
      const current = this.get(id);
      if (current.state === 'complete') return current;
      if (current.state !== 'relocated')
        conflict('Inbox source has not been relocated');
      this.assertSource(current, true);
      this.sqlite
        .prepare(
          "UPDATE inbox_migrations SET state='complete',updated_at=? WHERE id=?",
        )
        .run(new Date().toISOString(), id);
      return this.get(id);
    })();
  }
}
