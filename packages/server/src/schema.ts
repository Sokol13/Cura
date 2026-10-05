import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { ScanSummary } from '@cura/shared';

// Infrastructure metadata only; domain tables belong to later project phases.
export const appMetadata = sqliteTable('app_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// Domain foreign keys are declared in the versioned SQL migrations.
export const rootScanSummaries = sqliteTable(
  'root_scan_summaries',
  {
    rootId: text('root_id').primaryKey().notNull(),
    libraryId: text('library_id').notNull(),
    scanId: text('scan_id').notNull().unique(),
    payload: text('payload', { mode: 'json' }).$type<ScanSummary>().notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('root_scan_summaries_library').on(table.libraryId)],
);
