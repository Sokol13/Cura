import { z } from 'zod';
import {
  AnnotationSchema,
  AssetSchema,
  AssetVersionSchema,
  CollectionSchema,
  FolderSchema,
  IdSchema,
  LibrarySchema,
  TagGroupSchema,
  TagSchema,
  TimestampSchema,
} from './catalog.js';
import {
  BoardSchema,
  BoardItemSchema,
  BoardEdgeSchema,
  BoardSlotSchema,
  SlotRevisionSchema,
  SlotTemplateSchema,
} from './boards.js';
import {
  BrandSchema,
  BrandColorSchema,
  BrandFontSchema,
  BrandLogoSchema,
  CmfBoardSchema,
  CmfEntrySchema,
} from './brands.js';
import {
  FinalSelectionSchema,
  RecordedGenerationSchema,
  GenerationJobSchema,
} from './process.js';

import {
  AutomationJobSchema,
  AutomationProposalSchema,
  AutomationChangeSchema,
  ArchiveRuleSchema,
  ScriptBreakdownSchema,
  SettingDocumentSchema,
} from './automation.js';

export const SyncHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const SyncSequenceSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine(
    (value) => BigInt(value) <= 9223372036854775807n,
    'Sequence exceeds bigint',
  );
// JSON-valued authored provenance is deliberately open; the surrounding domain is strict.
const jsonObject = z.record(z.string(), z.json());
const file = {
  hash: SyncHashSchema,
  generationId: IdSchema,
  exif: jsonObject,
  params: jsonObject,
};
export const PortableAssetSchema = AssetSchema.omit({
  rootId: true,
  relativePath: true,
  missing: true,
  tags: true,
  finalized: true,
  previewState: true,
  previewRevision: true,
  previewError: true,
})
  .extend({
    ...file,
    displayName: z.string().nullable().default(null),
    archivedAt: TimestampSchema.nullable().default(null),
  })
  .strict();
export const PortableVersionSchema = AssetVersionSchema.omit({
  previewState: true,
  previewRevision: true,
  previewError: true,
})
  .extend(file)
  .strict();
export const PortableAssetTagSchema = z
  .object({
    assetId: IdSchema,
    tagId: IdSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export const PortableAssetAggregateSchema = z
  .object({
    asset: PortableAssetSchema,
    versions: z.array(PortableVersionSchema),
    annotations: z.array(AnnotationSchema.strict()),
    tagLinks: z.array(PortableAssetTagSchema),
    manualSelection: FinalSelectionSchema.strict().nullable(),
  })
  .strict();
export const PortableBoardAggregateSchema = z
  .object({
    board: BoardSchema.strict(),
    items: z.array(BoardItemSchema.strict()),
    edges: z.array(BoardEdgeSchema.strict()),
    slots: z.array(BoardSlotSchema.strict()),
    revisions: z.array(SlotRevisionSchema.strict()),
    finalSelections: z.array(FinalSelectionSchema.strict()),
  })
  .strict();
export const PortableBrandSchema = BrandSchema.extend({
  colors: z.array(BrandColorSchema.omit({ rgb: true, cmyk: true }).strict()),
  fonts: z.array(BrandFontSchema.strict()),
  logos: z.array(BrandLogoSchema.strict()),
}).strict();
export const PortableCmfSchema = CmfBoardSchema.extend({
  entries: z.array(CmfEntrySchema.strict()),
}).strict();
export const PortableActivitySchema = z
  .object({
    id: IdSchema,
    libraryId: IdSchema,
    assetId: IdSchema.nullable(),
    action: z.string().min(1).max(100),
    details: jsonObject,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
const terminalJob = GenerationJobSchema.extend({
  status: z.enum(['completed', 'failed', 'cancelled']),
}).strict();
export function portableRecord<K extends string, T extends z.ZodType>(
  kind: K,
  data: T,
) {
  return z
    .object({ kind: z.literal(kind), id: IdSchema, libraryId: IdSchema, data })
    .strict();
}
export const PortableRecordSchema = z.discriminatedUnion('kind', [
  portableRecord('library', LibrarySchema.strict()),
  portableRecord('asset', PortableAssetAggregateSchema),
  portableRecord('folder', FolderSchema.strict()),
  portableRecord('tagGroup', TagGroupSchema.strict()),
  portableRecord('tag', TagSchema.strict()),
  portableRecord('collection', CollectionSchema.strict()),
  portableRecord('template', SlotTemplateSchema.strict()),
  portableRecord('board', PortableBoardAggregateSchema),
  portableRecord('brand', PortableBrandSchema),
  portableRecord('cmf', PortableCmfSchema),
  portableRecord(
    'generation',
    RecordedGenerationSchema.extend({ hash: SyncHashSchema }).strict(),
  ),
  portableRecord('generationJob', terminalJob),
  portableRecord('activity', PortableActivitySchema),
  portableRecord(
    'automationJob',
    AutomationJobSchema.extend({
      status: z.enum(['completed', 'failed', 'cancelled']),
    }),
  ),
  portableRecord('automationProposal', AutomationProposalSchema),
  portableRecord('automationChange', AutomationChangeSchema),
  portableRecord('archiveRule', ArchiveRuleSchema),
  portableRecord('scriptBreakdown', ScriptBreakdownSchema),
  portableRecord('settingDocument', SettingDocumentSchema),
]);
export const SyncChangeSchema = z
  .object({
    kind: z.string().min(1).max(64),
    key: IdSchema,
    expectedRevision: SyncSequenceSchema,
    payload: PortableRecordSchema.nullable(),
    tombstone: z.boolean(),
  })
  .strict()
  .refine(
    (value) => value.tombstone === (value.payload === null),
    'Tombstone requires null payload',
  );
export const SyncRemoteRecordSchema = SyncChangeSchema.omit({
  expectedRevision: true,
})
  .extend({
    revision: SyncSequenceSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export const SyncCommitSchema = z
  .object({
    sequence: SyncSequenceSchema,
    operationId: IdSchema,
    changes: z.array(SyncRemoteRecordSchema).max(10000),
  })
  .strict();
export const SyncPullSchema = z
  .object({
    head: SyncSequenceSchema,
    cursor: SyncSequenceSchema,
    hasMore: z.boolean(),
    commits: z.array(SyncCommitSchema).max(100),
  })
  .strict();
export type PortableRecord = z.infer<typeof PortableRecordSchema>;
export type PortableAsset = z.infer<typeof PortableAssetSchema>;
export type PortableVersion = z.infer<typeof PortableVersionSchema>;
export type SyncChange = z.infer<typeof SyncChangeSchema>;
export type SyncRemoteRecord = z.infer<typeof SyncRemoteRecordSchema>;
export type SyncCommit = z.infer<typeof SyncCommitSchema>;
export type SyncPull = z.infer<typeof SyncPullSchema>;
