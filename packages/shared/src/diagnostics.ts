import { z } from 'zod';
import {
  IdSchema,
  ScanErrorSchema,
  ScanSummarySchema,
  TimestampSchema,
} from './catalog.js';

const count = z.number().int().nonnegative();
export const DiagnosticCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);
export const DiagnosticCaptureSchema = z
  .object({
    status: z.enum(['ok', 'partial', 'unavailable']),
    code: DiagnosticCodeSchema.optional(),
  })
  .strict();
export const DIAGNOSTIC_MESSAGES = {
  http: 'An HTTP operation reported a warning or error.',
  media: 'A media operation reported a warning or error.',
  scan: 'A folder scan reported a warning or error.',
  metadata: 'Metadata processing reported a warning.',
  thumbnail: 'Thumbnail processing reported a warning or error.',
  sync: 'Cloud synchronization reported a warning or error.',
  startup: 'Startup reported a warning or error.',
  other: 'An operation reported a warning or error.',
} as const;
export const DiagnosticOperationSchema = z.enum([
  'http',
  'media',
  'scan',
  'metadata',
  'thumbnail',
  'sync',
  'startup',
  'other',
]);
export const DiagnosticLogSchema = z
  .object({
    level: z.union([z.literal(40), z.literal(50), z.literal(60)]),
    time: count,
    operation: DiagnosticOperationSchema,
    code: DiagnosticCodeSchema,
    rootId: IdSchema.optional(),
    assetId: IdSchema.optional(),
    versionId: IdSchema.optional(),
    libraryId: IdSchema.optional(),
    count: count.optional(),
    msg: z.enum(Object.values(DIAGNOSTIC_MESSAGES)),
  })
  .strict();
export const DiagnosticEventSchema = DiagnosticLogSchema.omit({
  time: true,
  msg: true,
});
export const DiagnosticLogsSnapshotSchema = z
  .object({
    entries: z.array(DiagnosticLogSchema).max(200),
    capture: DiagnosticCaptureSchema,
  })
  .strict();
export const LogsSnapshotSchema = DiagnosticLogsSnapshotSchema;

export const MediaJobKindSchema = z.enum([
  'scan',
  'process',
  'preview',
  'cache-info',
  'cache-clear',
]);
export const MediaQueueDiagnosticsSchema = z
  .object({
    activeJobKind: MediaJobKindSchema.nullable(),
    queuedJobs: count.max(64),
    queuedByKind: z
      .object({
        scan: count,
        process: count,
        preview: count,
        'cache-info': count,
        'cache-clear': count,
      })
      .strict(),
    capacity: z.literal(64),
    pendingFiles: count,
    activeScans: count,
    nativeReservedVersions: count,
    closed: z.boolean(),
    workerFailed: z.boolean(),
    acceptingWork: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      value.queuedJobs ===
      Object.values(value.queuedByKind).reduce((sum, n) => sum + n, 0),
    'Queued job counts must agree',
  );

export const PreviewStateCountsSchema = z
  .object({
    total: count,
    ready: count,
    pending: count,
    failed: count,
    unsupported: count,
    notApplicable: count,
  })
  .strict()
  .refine(
    (value) =>
      value.total ===
      value.ready +
        value.pending +
        value.failed +
        value.unsupported +
        value.notApplicable,
    'Preview state counts must match all retained versions',
  );

export const DiagnosticTableSchema = z.enum([
  'activity',
  'annotations',
  'app_metadata',
  'archive_rules',
  'asset_fts',
  'asset_sources',
  'asset_tags',
  'asset_versions',
  'assets',
  'automation_changes',
  'automation_jobs',
  'automation_proposals',
  'board_edges',
  'board_items',
  'boards',
  'brand_colors',
  'brand_fonts',
  'brand_logos',
  'brands',
  'cmf_boards',
  'cmf_entries',
  'collections',
  'export_jobs',
  'fcpxml_jobs',
  'final_selections',
  'folders',
  'generation_jobs',
  'libraries',
  'library_roots',
  'recorded_generations',
  'root_scan_summaries',
  'inbox_migrations',
  'script_breakdowns',
  'setting_documents',
  'settings',
  'slot_revisions',
  'slot_templates',
  'slots',
  'sync_baselines',
  'sync_conflicts',
  'sync_links',
  'sync_outbox',
  'sync_staged_commits',
  'tag_groups',
  'tags',
]);
export const DatabaseIntegrityDiagnosticsSchema = z
  .object({
    status: z.enum(['ok', 'issues', 'error', 'timeout']),
    checkedAt: TimestampSchema,
    durationMs: count,
    integrityCheck: z.enum(['ok', 'issues', 'error', 'not-run']),
    foreignKeyCheck: z.enum(['ok', 'issues', 'error', 'not-run']),
    issues: z
      .array(
        z
          .object({
            code: z.enum([
              'INTEGRITY_VIOLATION',
              'FOREIGN_KEY_VIOLATION',
              'CHECK_FAILED',
            ]),
            table: DiagnosticTableSchema.optional(),
            parent: DiagnosticTableSchema.optional(),
            rowid: z.number().int().nullable().optional(),
            foreignKeyId: count.optional(),
          })
          .strict(),
      )
      .max(20),
    truncated: z.boolean(),
    code: z
      .enum([
        'SQLITE_OPEN_FAILED',
        'SQLITE_CHECK_FAILED',
        'INTEGRITY_WORKER_FAILED',
        'INTEGRITY_TIMEOUT',
      ])
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.status !== 'ok' ||
      (value.integrityCheck === 'ok' &&
        value.foreignKeyCheck === 'ok' &&
        value.issues.length === 0 &&
        !value.truncated),
    'Healthy integrity requires both checks to succeed',
  );

export const DiagnosticStatsSchema = z
  .object({
    libraries: count,
    roots: count,
    assets: count,
    sources: count,
    versions: count,
    folders: count,
    tags: count,
    tagGroups: count,
    collections: count,
    annotations: count,
    activities: count,
  })
  .strict();
export const RedactedScanSummarySchema = ScanSummarySchema.safeExtend({
  errors: z.array(ScanErrorSchema.extend({ relativePath: z.null() })).max(50),
});
export const DiagnosticRootScanSchema = z
  .object({
    rootId: IdSchema,
    libraryId: IdSchema,
    latestScanSummary: RedactedScanSummarySchema.nullable(),
    capture: DiagnosticCaptureSchema,
  })
  .strict();
const systemToken = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9._+-]+$/);
export const DiagnosticsSystemSchema = z
  .object({
    version: systemToken,
    platform: z.enum([
      'aix',
      'android',
      'darwin',
      'freebsd',
      'haiku',
      'linux',
      'openbsd',
      'sunos',
      'win32',
      'cygwin',
      'netbsd',
      'unknown',
    ]),
    release: systemToken,
    arch: z.enum([
      'arm',
      'arm64',
      'ia32',
      'loong64',
      'mips',
      'mipsel',
      'ppc',
      'ppc64',
      'riscv64',
      's390',
      's390x',
      'x64',
      'unknown',
    ]),
    node: systemToken,
  })
  .strict();
export const DiagnosticsSchema = DiagnosticsSystemSchema.extend({
  schemaVersion: z.literal(1),
  createdAt: TimestampSchema,
  pathsRedacted: z.literal(true),
  stats: DiagnosticStatsSchema.nullable(),
  rootScanSummaries: z.array(DiagnosticRootScanSchema),
  mediaQueue: MediaQueueDiagnosticsSchema.nullable(),
  previewStates: PreviewStateCountsSchema.nullable(),
  integrity: DatabaseIntegrityDiagnosticsSchema,
  capture: z
    .object({
      stats: DiagnosticCaptureSchema,
      scans: DiagnosticCaptureSchema,
      queue: DiagnosticCaptureSchema,
      previewStates: DiagnosticCaptureSchema,
      logs: DiagnosticCaptureSchema,
    })
    .strict(),
}).strict();

export type DiagnosticCapture = z.infer<typeof DiagnosticCaptureSchema>;
export type DiagnosticLog = z.infer<typeof DiagnosticLogSchema>;
export type DiagnosticEvent = z.infer<typeof DiagnosticEventSchema>;
export type DiagnosticLogsSnapshot = z.infer<
  typeof DiagnosticLogsSnapshotSchema
>;
export type LogsSnapshot = DiagnosticLogsSnapshot;
export type MediaQueueDiagnostics = z.infer<typeof MediaQueueDiagnosticsSchema>;
export type PreviewStateCounts = z.infer<typeof PreviewStateCountsSchema>;
export type DatabaseIntegrityDiagnostics = z.infer<
  typeof DatabaseIntegrityDiagnosticsSchema
>;
export type DiagnosticStats = z.infer<typeof DiagnosticStatsSchema>;
export type DiagnosticRootScan = z.infer<typeof DiagnosticRootScanSchema>;
export type Diagnostics = z.infer<typeof DiagnosticsSchema>;
