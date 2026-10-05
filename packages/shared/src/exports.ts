import { z } from 'zod';
import { AutomationExportSchema } from './automation.js';
import { SyncConflictDetailSchema } from './sync.js';
import { FcpxmlJobSchema } from './fcpxml.js';
import {
  AnnotationSchema,
  AssetSchema,
  AssetVersionSchema,
  CollectionSchema,
  FolderSchema,
  IdSchema,
  LibraryRootSchema,
  LibrarySchema,
  TagGroupSchema,
  TagSchema,
  TimestampSchema,
} from './catalog.js';
import {
  FinalSelectionSchema,
  GenerationJobSchema,
  RecordedGenerationSchema,
} from './process.js';

const JsonRecordSchema = z.record(z.string(), z.unknown());
export const ExportRequestSchema = z
  .object({
    scope: z.enum(['library', 'selection']).default('library'),
    assetIds: z.array(IdSchema).max(10000).default([]),
  })
  .strict()
  .refine(
    (input) =>
      input.scope === 'library'
        ? input.assetIds.length === 0
        : input.assetIds.length > 0,
    'Choose a whole library or at least one selected asset',
  );
const ExportPreviewTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const ExportCreateRequestSchema = ExportRequestSchema.safeExtend({
  expectedPreviewToken: ExportPreviewTokenSchema.optional(),
});
export const ExportDependencyReasonSchema = z.enum([
  'board',
  'brand',
  'automation',
  'fcpxml',
  'sync-conflict',
  'similar-to',
  'generation-output',
]);
export const ExportPreviewSchema = z
  .object({
    libraryId: IdSchema,
    scope: z.enum(['library', 'selection']),
    requestedAssetIds: z.array(IdSchema),
    includedDependencyAssetIds: z.array(IdSchema),
    requestedAssetCount: z.number().int().nonnegative(),
    dependencyAssetCount: z.number().int().nonnegative(),
    totalAssetCount: z.number().int().nonnegative(),
    reasons: z
      .array(
        z
          .object({
            reason: ExportDependencyReasonSchema,
            count: z.number().int().positive(),
          })
          .strict(),
      )
      .max(7),
    previewToken: ExportPreviewTokenSchema,
  })
  .strict()
  .superRefine((preview, ctx) => {
    const requested = new Set(preview.requestedAssetIds);
    const dependencies = new Set(preview.includedDependencyAssetIds);
    if (
      requested.size !== preview.requestedAssetIds.length ||
      dependencies.size !== preview.includedDependencyAssetIds.length ||
      [...dependencies].some((id) => requested.has(id))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Preview asset memberships must be unique and disjoint',
      });
    if (
      preview.requestedAssetCount !== requested.size ||
      preview.dependencyAssetCount !== dependencies.size ||
      preview.totalAssetCount !== requested.size + dependencies.size
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Preview counts must match actual asset memberships',
      });
    if (
      new Set(preview.reasons.map((value) => value.reason)).size !==
        preview.reasons.length ||
      preview.reasons.some((value) => value.count > dependencies.size)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Preview reasons must be unique and count only dependencies',
      });
    if (preview.scope === 'library' && dependencies.size)
      ctx.addIssue({
        code: 'custom',
        message: 'Whole-library previews have no dependency assets',
      });
  });
export const ExportFileSchema = z.object({
  path: z.string(),
  sha256: z.string().regex(/^[a-f\d]{64}$/i),
  size: z.number().int().nonnegative(),
  versionIds: z.array(IdSchema),
  type: z.string(),
});
export const ExportExceptionSchema = z.object({
  code: z.string(),
  message: z.string(),
  assetId: IdSchema.optional(),
  versionId: IdSchema.optional(),
});
export const ExportManifestSchema = z.object({
  format: z.literal('cura-export/1'),
  exportedAt: TimestampSchema,
  scope: z.enum(['library', 'selection']),
  requestedAssetIds: z.array(IdSchema),
  includedDependencyAssetIds: z.array(IdSchema),
  library: LibrarySchema,
  roots: z.array(
    LibraryRootSchema.extend({
      removedAt: TimestampSchema.nullable(),
      managed: z.boolean().default(false),
    }),
  ),
  assets: z.array(AssetSchema),
  versions: z.array(AssetVersionSchema.extend({ file: z.string().nullable() })),
  sources: z.array(
    z.object({
      id: IdSchema,
      assetId: IdSchema,
      rootId: IdSchema,
      relativePath: z.string(),
      actualRelativePath: z.string(),
      lastHash: z.string(),
      available: z.boolean(),
      createdAt: TimestampSchema,
      updatedAt: TimestampSchema,
    }),
  ),
  folders: z.array(FolderSchema),
  tagGroups: z.array(TagGroupSchema),
  tags: z.array(TagSchema),
  assetTags: z.array(
    z.object({
      assetId: IdSchema,
      tagId: IdSchema,
      createdAt: TimestampSchema,
      updatedAt: TimestampSchema,
    }),
  ),
  collections: z.array(CollectionSchema),
  annotations: z.array(AnnotationSchema),
  process: z.object({
    generations: z.array(RecordedGenerationSchema),
    finalSelections: z.array(FinalSelectionSchema),
    jobs: z.array(GenerationJobSchema),
  }),
  boards: JsonRecordSchema,
  brands: JsonRecordSchema,
  automation: AutomationExportSchema.default({
    jobs: [],
    proposals: [],
    changes: [],
    rules: [],
    scripts: [],
    documents: [],
    pins: [],
  }),
  syncConflicts: z.array(SyncConflictDetailSchema).default([]),
  fcpxml: z.array(FcpxmlJobSchema).default([]),
  activity: z.array(JsonRecordSchema),
  files: z.array(ExportFileSchema),
  exceptions: z.array(ExportExceptionSchema),
});
export const ExportJobSchema = z.object({
  id: IdSchema,
  libraryId: IdSchema,
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  progress: z.number().min(0).max(1),
  request: ExportRequestSchema,
  filename: z.string().nullable(),
  bytes: z.number().int().nonnegative(),
  exceptions: z.array(ExportExceptionSchema),
  error: z.string().nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export const ExportJobsSchema = z.array(ExportJobSchema);
export type ExportRequest = z.input<typeof ExportRequestSchema>;
export type ExportInput = z.output<typeof ExportRequestSchema>;
export type ExportManifest = z.infer<typeof ExportManifestSchema>;
export type ExportJob = z.infer<typeof ExportJobSchema>;
export type ExportException = z.infer<typeof ExportExceptionSchema>;

export type ExportCreateRequest = z.input<typeof ExportCreateRequestSchema>;
export type ExportDependencyReason = z.infer<
  typeof ExportDependencyReasonSchema
>;
export type ExportPreview = z.infer<typeof ExportPreviewSchema>;
