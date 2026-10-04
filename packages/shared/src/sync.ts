import { z } from 'zod';
import { IdSchema, TimestampSchema } from './catalog.js';
import {
  PortableRecordSchema,
  SyncSequenceSchema,
  SyncRemoteRecordSchema,
} from './sync-portable.js';
export * from './sync-portable.js';

const time = { createdAt: TimestampSchema, updatedAt: TimestampSchema };
const count = z.number().int().nonnegative();
export const SyncRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export const SyncProblemSchema = z
  .object({ code: z.string().min(1).max(100), error: z.string().max(1000) })
  .strict();
export const SyncAccountSchema = z
  .object({ id: IdSchema, email: z.string().nullable() })
  .strict();
export const SyncLinkSchema = z
  .object({
    id: IdSchema,
    libraryId: IdSchema,
    name: z.string(),
    role: SyncRoleSchema,
    materialized: z.boolean(),
    state: z.enum([
      'initializing',
      'idle',
      'syncing',
      'paused',
      'offline',
      'blocked',
      'error',
    ]),
    phase: z
      .enum(['snapshot', 'upload', 'publish', 'download', 'apply'])
      .nullable(),
    progress: z.object({ completed: count, total: count.nullable() }).strict(),
    paused: z.boolean(),
    pendingChanges: count,
    conflictCount: count,
    cursor: SyncSequenceSchema,
    lastSyncedAt: TimestampSchema.nullable(),
    lastError: SyncProblemSchema.nullable(),
    ...time,
  })
  .strict();
export const SyncStatusSchema = z
  .object({
    configured: z.boolean(),
    auth: z.enum([
      'unconfigured',
      'signed-out',
      'signed-in',
      'expired',
      'offline',
    ]),
    account: SyncAccountSchema.nullable(),
    links: z.array(SyncLinkSchema),
    error: SyncProblemSchema.nullable(),
  })
  .strict();
export const CloudLibrarySchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    ownerId: IdSchema,
    role: SyncRoleSchema,
    ...time,
  })
  .strict();
export const CloudLibrariesSchema = z.array(CloudLibrarySchema);
export const SyncMemberSchema = z
  .object({
    libraryId: IdSchema,
    userId: IdSchema,
    role: SyncRoleSchema,
    ...time,
  })
  .strict();
export const SyncMembersSchema = z.array(SyncMemberSchema);
export const SyncConflictSummarySchema = z
  .object({
    id: IdSchema,
    linkId: IdSchema,
    libraryId: IdSchema,
    entityKind: z.string().min(1).max(64),
    entityId: IdSchema,
    resolution: z.enum(['local-wins', 'merged-history', 'final-protection']),
    changedFields: z.array(z.string().max(500)),
    ...time,
  })
  .strict();
export const SyncConflictsSchema = z.array(SyncConflictSummarySchema);
export const SyncConflictDetailSchema = SyncConflictSummarySchema.extend({
  base: PortableRecordSchema.nullable(),
  local: PortableRecordSchema.nullable(),
  remote: PortableRecordSchema.nullable(),
  resolved: PortableRecordSchema.nullable(),
  ordinalRemaps: z.array(
    z
      .object({
        kind: z.enum(['assetVersion', 'slotRevision']),
        id: IdSchema,
        from: z.number().int().positive(),
        to: z.number().int().positive(),
      })
      .strict(),
  ),
}).strict();
export const SyncSignInSchema = z
  .object({ email: z.email().max(320), password: z.string().min(1).max(10000) })
  .strict();
export const SyncLibraryRequestSchema = z
  .object({ libraryId: IdSchema })
  .strict();
export const SyncLinkPatchSchema = z.object({ paused: z.boolean() }).strict();
export const SyncMemberUpsertSchema = z
  .object({ role: z.enum(['editor', 'viewer']) })
  .strict();
export const SyncEmptyRequestSchema = z.object({}).strict();
export type SyncRole = z.infer<typeof SyncRoleSchema>;
export type SyncAccount = z.infer<typeof SyncAccountSchema>;
export type SyncProblem = z.infer<typeof SyncProblemSchema>;
export type SyncLink = z.infer<typeof SyncLinkSchema>;
export type SyncStatus = z.infer<typeof SyncStatusSchema>;
export type CloudLibrary = z.infer<typeof CloudLibrarySchema>;
export type SyncMember = z.infer<typeof SyncMemberSchema>;
export type SyncConflictSummary = z.infer<typeof SyncConflictSummarySchema>;
export type SyncConflictDetail = z.infer<typeof SyncConflictDetailSchema>;
export type SyncSignIn = z.infer<typeof SyncSignInSchema>;

// Strict cloud adapter envelopes; cloud timestamps/revisions are distinct from domain metadata.
export const SyncRemoteLibrarySchema = CloudLibrarySchema.extend({
  published: z.boolean(),
  head: SyncSequenceSchema,
}).strict();
export const SyncLibraryEnvelopeSchema = z
  .object({ library: SyncRemoteLibrarySchema })
  .strict();
export const SyncLibrariesEnvelopeSchema = z
  .object({ libraries: z.array(SyncRemoteLibrarySchema) })
  .strict();
export const SyncMembersEnvelopeSchema = z
  .object({ members: z.array(SyncMemberSchema.omit({ libraryId: true })) })
  .strict();

export const SyncManifestSchema = z
  .object({
    library: SyncRemoteLibrarySchema,
    sequence: SyncSequenceSchema,
    records: z.array(SyncRemoteRecordSchema).max(10000),
  })
  .strict();
export type SyncManifest = z.infer<typeof SyncManifestSchema>;
export type SyncRemoteLibrary = z.infer<typeof SyncRemoteLibrarySchema>;
