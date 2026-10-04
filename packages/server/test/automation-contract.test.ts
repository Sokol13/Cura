import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  AutomationApplyRequestSchema,
  AutomationProviderInfoSchema,
  AutomationExportSchema,
  ScriptUpdateSchema,
  ScriptReferenceSchema,
  ArchiveRuleUpdateSchema,
} from '../../shared/src/automation.js';

describe('automation boundary contracts', () => {
  it('requires exact source version and changed field values for selected application', () => {
    const item = {
      proposalId: randomUUID(),
      expectedVersionId: randomUUID(),
      changes: [{ changeId: randomUUID(), expectedValue: null }],
    };
    expect(
      AutomationApplyRequestSchema.parse({ items: [item] }).items,
    ).toHaveLength(1);
    expect(
      AutomationApplyRequestSchema.safeParse({
        items: [{ ...item, expectedVersionId: undefined }],
      }).success,
    ).toBe(false);
    expect(
      AutomationApplyRequestSchema.safeParse({
        items: [{ ...item, changes: [{ changeId: randomUUID() }] }],
      }).success,
    ).toBe(false);
  });
  it('rejects credential and endpoint leakage in public providers and portable data', () => {
    const info = {
      id: 'metadata-rules',
      label: 'Metadata rules',
      kind: 'metadata-rules',
      mode: 'rules',
      configured: true,
      capabilities: ['vision-proposals'],
    };
    expect(AutomationProviderInfoSchema.safeParse(info).success).toBe(true);
    expect(
      AutomationProviderInfoSchema.safeParse({ ...info, apiKey: 'secret' })
        .success,
    ).toBe(false);
    expect(
      AutomationExportSchema.safeParse({
        jobs: [],
        proposals: [],
        changes: [],
        rules: [],
        scripts: [],
        documents: [],
        pins: [],
        config: { url: 'private' },
      }).success,
    ).toBe(false);
  });
  it('does not reset enabled when a rule patch changes only its name', () => {
    expect(
      ArchiveRuleUpdateSchema.parse({ expectedRevision: 1, name: 'New' }),
    ).toEqual({ expectedRevision: 1, name: 'New' });
  });
  it('retains derived source excerpts with validated line boundaries', () => {
    expect(
      ScriptReferenceSchema.parse({
        startLine: 1,
        endLine: 2,
        excerpt: 'INT. ROOM\nALICE',
      }).excerpt,
    ).toBe('INT. ROOM\nALICE');
  });
  it('rejects inverted script ranges and requires optimistic revisions', () => {
    const input = {
      expectedRevision: 0,
      entities: [
        {
          kind: 'character',
          name: 'ALICE',
          notes: '',
          ranges: [{ startLine: 4, endLine: 2 }],
        },
      ],
    };
    expect(ScriptUpdateSchema.safeParse(input).success).toBe(false);
    expect(
      ScriptUpdateSchema.safeParse({
        ...input,
        entities: [],
        expectedRevision: undefined,
      }).success,
    ).toBe(false);
  });
  it('creates six constrained portable tables without touching existing catalog rows', () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      db.exec(
        "CREATE TABLE libraries(id TEXT PRIMARY KEY); CREATE TABLE assets(id TEXT PRIMARY KEY); CREATE TABLE asset_versions(id TEXT PRIMARY KEY); INSERT INTO libraries VALUES ('kept');",
      );
      db.exec(
        readFileSync(
          new URL('../drizzle/0006_automation.sql', import.meta.url),
          'utf8',
        ),
      );
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all();
      expect(tables).toHaveLength(9);
      expect(db.prepare('SELECT id FROM libraries').get()).toEqual({
        id: 'kept',
      });
      expect(() =>
        db
          .prepare(
            'INSERT INTO archive_rules(id,library_id,payload,created_at,updated_at) VALUES (?,?,?,?,?)',
          )
          .run('rule', 'missing', '{}', 'now', 'now'),
      ).toThrow(/FOREIGN KEY/);
    } finally {
      db.close();
    }
  });
});
