import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { ScanSummary } from '@cura/shared';
import type {
  InboxFileIdentity,
  InboxMigration,
} from './media/inbox-migration-store.js';

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

// Local filesystem recovery state, excluded from portable library graphs.
export const inboxMigrations = sqliteTable(
  'inbox_migrations',
  {
    id: text('id').primaryKey().notNull(),
    sourceId: text('source_id').notNull().unique(),
    assetId: text('asset_id').notNull(),
    libraryId: text('library_id').notNull(),
    rootId: text('root_id').notNull(),
    oldRelativePath: text('old_relative_path').notNull(),
    oldActualRelativePath: text('old_actual_relative_path').notNull(),
    newRelativePath: text('new_relative_path').notNull(),
    lastHash: text('last_hash').notNull(),
    sourceAvailable: integer('source_available', { mode: 'boolean' }).notNull(),
    sourceCreatedAt: text('source_created_at').notNull(),
    sourceUpdatedAt: text('source_updated_at').notNull(),
    observed: text('observed', { mode: 'json' })
      .$type<InboxFileIdentity>()
      .notNull(),
    target: text('target', { mode: 'json' }).$type<InboxFileIdentity>(),
    state: text('state').$type<InboxMigration['state']>().notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('inbox_migrations_pending').on(table.rootId, table.state)],
);
