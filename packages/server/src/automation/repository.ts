import * as C from '@cura/shared';
import type { AppDatabase } from '../database.js';
import { AutomationError } from './errors.js';
export const schemas = {
  automation_jobs: C.AutomationJobSchema,
  automation_proposals: C.AutomationProposalSchema,
  automation_changes: C.AutomationChangeSchema,
  archive_rules: C.ArchiveRuleSchema,
  script_breakdowns: C.ScriptBreakdownSchema,
  setting_documents: C.SettingDocumentSchema,
};
export type AutomationTable = keyof typeof schemas;
type Records = {
  automation_jobs: C.AutomationJob;
  automation_proposals: C.AutomationProposal;
  automation_changes: C.AutomationChange;
  archive_rules: C.ArchiveRule;
  script_breakdowns: C.ScriptBreakdown;
  setting_documents: C.SettingDocument;
};
export class AutomationRepository {
  constructor(readonly database: AppDatabase) {}
  get<K extends AutomationTable>(
    table: K,
    libraryId: string,
    id: string,
  ): Records[K] {
    const row = this.database.sqlite
      .prepare(`SELECT payload FROM ${table} WHERE id=? AND library_id=?`)
      .get(id, libraryId) as { payload: string } | undefined;
    if (!row) throw new AutomationError('NOT_FOUND', 404);
    return schemas[table].parse(JSON.parse(row.payload)) as Records[K];
  }
  all<K extends AutomationTable>(table: K, libraryId?: string): Records[K][] {
    const statement = this.database.sqlite.prepare(
      `SELECT payload FROM ${table}${libraryId ? ' WHERE library_id=?' : ''} ORDER BY created_at DESC,id`,
    );
    const rows = (libraryId ? statement.all(libraryId) : statement.all()) as {
      payload: string;
    }[];
    return rows.map(
      (row) => schemas[table].parse(JSON.parse(row.payload)) as Records[K],
    );
  }
  put<K extends AutomationTable>(table: K, value: Records[K]): Records[K] {
    const record = schemas[table].parse(value) as Records[K];
    const columns = ['id', 'library_id', 'payload', 'created_at', 'updated_at'];
    const values: unknown[] = [
      record.id,
      record.libraryId,
      JSON.stringify(record),
      record.createdAt,
      record.updatedAt,
    ];
    const add = (key: string, v: unknown) => {
      columns.push(key);
      values.push(v);
    };
    if ('jobId' in record) add('job_id', record.jobId);
    if ('proposalId' in record) add('proposal_id', record.proposalId);
    if ('assetId' in record) {
      add('asset_id', record.assetId);
      add('version_id', record.versionId);
    }
    if ('sourcePin' in record) {
      add('asset_id', record.sourcePin.assetId);
      add('version_id', record.sourcePin.versionId);
    }
    if ('field' in record) add('field', record.field);
    this.database.sqlite
      .prepare(
        `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`,
      )
      .run(...values);
    return record;
  }
  remove(table: AutomationTable, libraryId: string, id: string) {
    this.database.sqlite
      .prepare(`DELETE FROM ${table} WHERE id=? AND library_id=?`)
      .run(id, libraryId);
  }
}
export const now = () => new Date().toISOString();
export function page<T>(items: T[], query: unknown = {}) {
  const { offset, limit } = C.AutomationPageQuerySchema.parse(query);
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    offset,
    limit,
  };
}
