import { randomUUID } from 'node:crypto';
import * as S from '@cura/shared';
import type { AppDatabase } from '../database.js';
import { SyncError } from './errors.js';
import { payloadHash, recordKey, semanticHash } from './portable.js';
import { stableId } from './merge.js';
const now = () => new Date().toISOString();
interface PayloadRow {
  payload: string;
}
export interface SyncOperation {
  id: string;
  changes: S.SyncChange[];
  status: 'pending' | 'submitted' | 'acknowledged';
}
export class SyncState {
  constructor(readonly database: AppDatabase) {}
  private get row() {
    return this.database.sqlite;
  }
  links(projectId: string, accountId?: string): S.SyncLink[] {
    return (
      this.row
        .prepare(
          `SELECT payload FROM sync_links WHERE project_id=? ${accountId ? 'AND account_id=?' : ''} ORDER BY created_at,id`,
        )
        .all(
          ...(accountId ? [projectId, accountId] : [projectId]),
        ) as PayloadRow[]
    ).map((r) => S.SyncLinkSchema.parse(JSON.parse(r.payload)));
  }
  get(id: string): S.SyncLink {
    const row = this.row
      .prepare('SELECT payload FROM sync_links WHERE id=?')
      .get(id) as PayloadRow | undefined;
    if (!row) throw new SyncError('Sync link not found', 'SYNC_NOT_FOUND', 404);
    return S.SyncLinkSchema.parse(JSON.parse(row.payload));
  }
  requireAccount(id: string, projectId: string, accountId: string): S.SyncLink {
    if (
      !this.row
        .prepare(
          'SELECT id FROM sync_links WHERE id=? AND project_id=? AND account_id=?',
        )
        .get(id, projectId, accountId)
    )
      throw new SyncError(
        'This library is linked to a different cloud account',
        'SYNC_ACCOUNT_MISMATCH',
        403,
      );
    return this.get(id);
  }
  create(
    libraryId: string,
    name: string,
    role: S.SyncRole,
    materialized: boolean,
    projectId: string,
    accountId: string,
  ): S.SyncLink {
    const existing = this.row
      .prepare('SELECT id FROM sync_links WHERE library_id=?')
      .get(libraryId) as { id: string } | undefined;
    if (existing) return this.requireAccount(existing.id, projectId, accountId);
    const date = now(),
      link: S.SyncLink = {
        id: randomUUID(),
        libraryId,
        name,
        role,
        materialized,
        state: 'initializing',
        phase: null,
        progress: { completed: 0, total: null },
        paused: false,
        pendingChanges: 0,
        conflictCount: 0,
        cursor: '0',
        lastSyncedAt: null,
        lastError: null,
        createdAt: date,
        updatedAt: date,
      };
    this.row
      .prepare(
        'INSERT INTO sync_links (id,library_id,project_id,account_id,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run(
        link.id,
        libraryId,
        projectId,
        accountId,
        JSON.stringify(link),
        date,
        date,
      );
    return link;
  }
  update(
    id: string,
    patch: Partial<Omit<S.SyncLink, 'id' | 'libraryId' | 'createdAt'>>,
  ): S.SyncLink {
    const link = S.SyncLinkSchema.parse({
      ...this.get(id),
      ...patch,
      updatedAt: now(),
    });
    this.row
      .prepare(
        'UPDATE sync_links SET payload=?,cursor=?,updated_at=? WHERE id=?',
      )
      .run(JSON.stringify(link), link.cursor, link.updatedAt, id);
    return link;
  }
  baselines(linkId: string): S.SyncRemoteRecord[] {
    return (
      this.row
        .prepare(
          'SELECT * FROM sync_baselines WHERE link_id=? ORDER BY kind,record_key',
        )
        .all(linkId) as Array<{
        kind: string;
        record_key: string;
        revision: string;
        payload: string | null;
        created_at: string;
        updated_at: string;
      }>
    ).map((row) =>
      S.SyncRemoteRecordSchema.parse({
        kind: row.kind,
        key: row.record_key,
        revision: row.revision,
        payload: row.payload === null ? null : JSON.parse(row.payload),
        tombstone: row.payload === null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    );
  }
  saveBaselines(linkId: string, records: readonly S.SyncRemoteRecord[]): void {
    const statement = this.row.prepare(
      'INSERT INTO sync_baselines (id,link_id,kind,record_key,revision,payload,payload_hash,semantic_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(link_id,kind,record_key) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,payload_hash=excluded.payload_hash,semantic_hash=excluded.semantic_hash,updated_at=excluded.updated_at',
    );
    const previous = this.row.prepare(
      'SELECT revision,payload_hash FROM sync_baselines WHERE link_id=? AND kind=? AND record_key=?',
    );
    for (const record of records) {
      S.SyncRemoteRecordSchema.parse(record);
      const old = previous.get(linkId, record.kind, record.key) as
        | { revision: string; payload_hash: string }
        | undefined;
      if (old && BigInt(old.revision) > BigInt(record.revision)) continue;
      if (old && old.revision === record.revision) {
        if (old.payload_hash !== payloadHash(record.payload))
          throw new SyncError(
            'Cloud revision has inconsistent metadata',
            'SYNC_INVALID_RESPONSE',
            502,
          );
        continue;
      }
      statement.run(
        stableId(`${linkId}:${record.kind}:${record.key}`),
        linkId,
        record.kind,
        record.key,
        record.revision,
        record.payload === null ? null : JSON.stringify(record.payload),
        payloadHash(record.payload),
        semanticHash(record.payload),
        record.createdAt,
        record.updatedAt,
      );
    }
  }
  changes(
    linkId: string,
    records: readonly S.PortableRecord[],
  ): S.SyncChange[] {
    const local = new Map(records.map((r) => [recordKey(r), r])),
      base = new Map(
        this.baselines(linkId).map((r) => [`${r.kind}:${r.key}`, r]),
      );
    return [...new Set([...local.keys(), ...base.keys()])]
      .sort()
      .flatMap((key) => {
        const record = local.get(key),
          previous = base.get(key),
          value = record ?? null;
        if (semanticHash(value) === semanticHash(previous?.payload ?? null))
          return [];
        const kind = record?.kind ?? previous!.kind,
          id = record?.id ?? previous!.key;
        return [
          S.SyncChangeSchema.parse({
            kind,
            key: id,
            expectedRevision: previous?.revision ?? '0',
            payload: value,
            tombstone: value === null,
          }),
        ];
      });
  }
  pending(linkId: string): SyncOperation | null {
    const row = this.row
      .prepare(
        "SELECT id,payload,status,request_hash FROM sync_outbox WHERE link_id=? AND status<>'acknowledged' ORDER BY created_at,id LIMIT 1",
      )
      .get(linkId) as
      | {
          id: string;
          payload: string;
          status: SyncOperation['status'];
          request_hash: string;
        }
      | undefined;
    if (!row) return null;
    try {
      const changes = S.SyncChangeSchema.array()
        .min(1)
        .max(10000)
        .parse(JSON.parse(row.payload));
      if (payloadHash(changes) !== row.request_hash) throw new Error('hash');
      return { id: row.id, changes, status: row.status };
    } catch {
      throw new SyncError(
        'The saved pending operation is damaged; local work is retained',
        'SYNC_OUTBOX_CORRUPT',
        409,
      );
    }
  }

  enqueue(linkId: string, changes: S.SyncChange[]): SyncOperation {
    const previous = this.pending(linkId);
    if (previous) return previous;
    const operation = { id: randomUUID(), changes, status: 'pending' as const },
      date = now();
    this.row
      .prepare(
        'INSERT INTO sync_outbox (id,link_id,request_hash,payload,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run(
        operation.id,
        linkId,
        payloadHash(changes),
        JSON.stringify(changes),
        'pending',
        date,
        date,
      );
    return operation;
  }
  submitted(id: string): void {
    this.row
      .prepare(
        "UPDATE sync_outbox SET status='submitted',updated_at=? WHERE id=?",
      )
      .run(now(), id);
  }
  discard(id: string): void {
    this.row.prepare('DELETE FROM sync_outbox WHERE id=?').run(id);
  }
  acknowledge(
    linkId: string,
    operation: SyncOperation,
    commit: S.SyncCommit,
  ): void {
    if (
      commit.operationId !== operation.id ||
      commit.changes.length !== operation.changes.length
    )
      throw new SyncError(
        'Cloud acknowledgment does not match the submitted operation',
        'SYNC_INVALID_ACK',
        502,
      );
    for (const change of operation.changes) {
      const ack = commit.changes.find(
        (c) => c.kind === change.kind && c.key === change.key,
      );
      if (
        !ack ||
        payloadHash(ack.payload) !== payloadHash(change.payload) ||
        ack.tombstone !== change.tombstone ||
        BigInt(ack.revision) !== BigInt(change.expectedRevision) + 1n
      )
        throw new SyncError(
          'Cloud acknowledgment changed a submitted record',
          'SYNC_INVALID_ACK',
          502,
        );
    }
    this.row.transaction(() => {
      this.saveBaselines(linkId, commit.changes);
      this.row
        .prepare(
          "UPDATE sync_outbox SET status='acknowledged',updated_at=? WHERE id=?",
        )
        .run(now(), operation.id);
    })();
  }
  stage(linkId: string, commit: S.SyncCommit): void {
    const date = now();
    this.row
      .prepare(
        'INSERT INTO sync_staged_commits (id,link_id,sequence,payload,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(link_id,sequence) DO UPDATE SET payload=excluded.payload',
      )
      .run(
        stableId(`${linkId}:${commit.operationId}`),
        linkId,
        commit.sequence,
        JSON.stringify(commit),
        date,
        date,
      );
  }
  clearStage(linkId: string, sequence: string): void {
    this.row
      .prepare(
        'DELETE FROM sync_staged_commits WHERE link_id=? AND CAST(sequence AS INTEGER)<=CAST(? AS INTEGER)',
      )
      .run(linkId, sequence);
  }
  conflicts(linkId: string): S.SyncConflictSummary[] {
    this.get(linkId);
    return (
      this.row
        .prepare(
          'SELECT payload FROM sync_conflicts WHERE link_id=? ORDER BY created_at DESC,id LIMIT 500',
        )
        .all(linkId) as PayloadRow[]
    ).map((row) => {
      const detail = S.SyncConflictDetailSchema.parse(JSON.parse(row.payload));
      const {
        base: _base,
        local: _local,
        remote: _remote,
        resolved: _resolved,
        ordinalRemaps: _maps,
        ...summary
      } = detail;
      void _base;
      void _local;
      void _remote;
      void _resolved;
      void _maps;
      return summary;
    });
  }
  conflict(linkId: string, id: string): S.SyncConflictDetail {
    const row = this.row
      .prepare('SELECT payload FROM sync_conflicts WHERE id=? AND link_id=?')
      .get(id, linkId) as PayloadRow | undefined;
    if (!row)
      throw new SyncError('Conflict record not found', 'SYNC_NOT_FOUND', 404);
    return S.SyncConflictDetailSchema.parse(JSON.parse(row.payload));
  }
  saveConflicts(
    linkId: string,
    conflicts: readonly S.SyncConflictDetail[],
  ): void {
    for (const conflict of conflicts)
      this.row
        .prepare(
          'INSERT INTO sync_conflicts (id,link_id,kind,record_key,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
        )
        .run(
          conflict.id,
          linkId,
          conflict.entityKind,
          conflict.entityId,
          JSON.stringify(conflict),
          conflict.createdAt,
          conflict.updatedAt,
        );
    this.update(linkId, {
      conflictCount: (
        this.row
          .prepare('SELECT count(*) count FROM sync_conflicts WHERE link_id=?')
          .get(linkId) as { count: number }
      ).count,
    });
  }
}
